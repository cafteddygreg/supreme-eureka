import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'crypto';
import zlib from 'zlib';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI, Type } from '@google/genai';
import Tesseract from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const SECRET_KEY = process.env.SECRET_KEY || 'igitoro-secret-key-live';

app.set('trust proxy', 1);

export function isProductionEnv() {
  return process.env.NODE_ENV === 'production';
}

// Upload configuration
const uploadDir = path.join(__dirname, 'static', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format photo non accepté'));
    }
  }
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  '/static',
  express.static(path.join(__dirname, 'static'), {
    maxAge: '7d',
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.includes('uploads')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      }
    }
  })
);
// Store de session léger à purge automatique (évite le warning MemoryStore en production sur Railway et plafonne la RAM)
class PrunedSessionStore extends session.Store {
  constructor(maxEntries = 5000) {
    super();
    this.sessions = new Map();
    this.maxEntries = maxEntries;
  }
  get(sid, cb) {
    const entry = this.sessions.get(sid);
    if (!entry) return cb(null, null);
    if (entry.expires && Date.now() > entry.expires) {
      this.sessions.delete(sid);
      return cb(null, null);
    }
    try {
      cb(null, JSON.parse(entry.data));
    } catch (e) {
      cb(e);
    }
  }
  set(sid, sess, cb) {
    const maxAge = sess?.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
    if (this.sessions.size >= this.maxEntries && !this.sessions.has(sid)) {
      const oldestKey = this.sessions.keys().next().value;
      if (oldestKey) this.sessions.delete(oldestKey);
    }
    this.sessions.set(sid, {
      data: JSON.stringify(sess),
      expires: Date.now() + maxAge
    });
    if (cb) cb(null);
  }
  destroy(sid, cb) {
    this.sessions.delete(sid);
    if (cb) cb(null);
  }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(
  session({
    store: new PrunedSessionStore(),
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    }
  })
);

// Adapter dynamiquement les attributs de cookie en HTTPS (iframe preview / production Railway)
app.use((req, res, next) => {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isHttps && req.session && req.session.cookie) {
    req.session.cookie.secure = true;
    req.session.cookie.sameSite = 'none';
  }
  next();
});

// Dynamic Rate Limiter
class DynamicRateLimiter {
  constructor(baseLimit = 10, windowMs = 3600000) {
    this.baseLimit = baseLimit;
    this.windowMs = windowMs;
    this.events = new Map();
  }
  allow(key, risk = 0) {
    const now = Date.now();
    let q = this.events.get(key) || [];
    q = q.filter(t => now - t <= this.windowMs);
    const limit = Math.max(1, this.baseLimit - risk);
    if (q.length >= limit) {
      this.events.set(key, q);
      return false;
    }
    q.push(now);
    this.events.set(key, q);
    return true;
  }
}
const limiter = new DynamicRateLimiter();

// ================= OAuth 2.0 / OpenID Connect Verification =================
const googleOAuthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || '',
  process.env.GOOGLE_CLIENT_SECRET || ''
);

/**
 * Vérifie en développement local uniquement un jeton JWT OIDC de test signé par HMAC-SHA256.
 * STRICTEMENT DÉSACTIVÉ EN PRODUCTION (NODE_ENV=production ou APP_ENV=production).
 */
function verifyLocalDevTestJwt(token) {
  if (isProductionEnv()) {
    throw new Error('Les jetons de test locaux sont strictement interdits en production.');
  }
  if (process.env.ALLOW_DEV_OIDC_TEST_TOKEN === 'false') {
    throw new Error('Le mode de test OIDC local est désactivé.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Format JWT invalide');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Signature JWT de test invalide');
  }

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256' || header.kid !== 'local-dev-test-only') {
    throw new Error('En-tête JWT non autorisé');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) {
    throw new Error('Émetteur (iss) OIDC invalide');
  }

  const expectedAud = process.env.GOOGLE_CLIENT_ID || 'igitoro-local-test-client';
  if (payload.aud !== expectedAud) {
    throw new Error('Audience (aud) OIDC invalide');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec) {
    throw new Error('Jeton OIDC expiré');
  }

  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim().length < 3) {
    throw new Error('Identifiant Google (sub) manquant ou invalide');
  }

  return {
    sub: payload.sub.trim(),
    email: payload.email || null,
    email_verified: payload.email_verified !== false,
    name: payload.name || 'Utilisateur Google'
  };
}

/**
 * Vérifie de manière cryptographique un ID Token Google OpenID Connect côté serveur.
 * Rejette catégoriquement tout nom saisi manuellement, toute chaîne "mock:..." ou tout jeton invalide.
 */
export async function verifyGoogleOidcToken(credential) {
  if (!credential || typeof credential !== 'string' || !credential.trim()) {
    const err = new Error('Jeton Google OIDC manquant');
    err.status = 400;
    throw err;
  }

  const rawToken = credential.trim();

  // Interdiction absolue des chaînes mock:... ou de simples noms saisis par l'utilisateur
  if (rawToken.startsWith('mock:') || !rawToken.includes('.')) {
    const err = new Error('Authentification refusée : un véritable jeton OAuth 2.0 / OpenID Connect signé par Google est requis.');
    err.status = 401;
    throw err;
  }

  // En développement/test local uniquement (et jamais en production), vérifier si c'est un JWT de test signé par SECRET_KEY
  if (!isProductionEnv() && process.env.ALLOW_DEV_OIDC_TEST_TOKEN !== 'false') {
    const parts = rawToken.split('.');
    if (parts.length === 3) {
      let isLocalTestKid = false;
      try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        isLocalTestKid = header && header.kid === 'local-dev-test-only';
      } catch (_) {}

      if (isLocalTestKid) {
        try {
          return verifyLocalDevTestJwt(rawToken);
        } catch (devErr) {
          const err = new Error(`Jeton OIDC invalide : ${devErr.message}`);
          err.status = 401;
          throw err;
        }
      }
    }
  }

  // Vérification officielle Google OAuth 2.0 / OpenID Connect (RS256 JWKS Google)
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const err = new Error('GOOGLE_CLIENT_ID non configuré sur le serveur pour vérifier le jeton Google OIDC.');
    err.status = 401;
    throw err;
  }

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: rawToken,
      audience: clientId
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      throw new Error('Payload Google OIDC sans identifiant sub');
    }

    const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (!validIssuers.includes(payload.iss)) {
      throw new Error('Émetteur Google invalide');
    }

    return {
      sub: payload.sub,
      email: payload.email || null,
      email_verified: Boolean(payload.email_verified),
      name: payload.name || payload.given_name || 'Utilisateur Google'
    };
  } catch (verifyErr) {
    const err = new Error('Jeton Google OAuth 2.0 / OpenID Connect invalide ou expiré.');
    err.status = 401;
    throw err;
  }
}

// In-Memory Database
let nextUserId = 2;
let nextStationId = 29;
let nextReportId = 3;
let nextConfirmationId = 3;
let nextAbuseId = 1;
let nextSubId = 1;
let nextClaimId = 1;

const users = [
  {
    id: 1,
    google_sub: 'google-oidc-admin-seed-1',
    name: 'Tedd Greg',
    email: 'tedd@example.bi',
    is_admin: true,
    is_suspended: false,
    created_at: new Date().toISOString()
  }
];

function shouldGrantAdmin(sub, email) {
  const adminSubs = (process.env.ADMIN_GOOGLE_SUBS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const rawAdminEmails = [
    process.env.ADMIN_EMAIL || '',
    process.env.ADMIN_EMAILS || '',
    'bagloriose18@gmail.com',
    'tedd@example.bi'
  ].join(',');
  const adminEmails = rawAdminEmails
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (sub && adminSubs.includes(sub)) return true;
  if (email && adminEmails.includes(email.toLowerCase())) return true;
  return false;
}

function findOrCreateGoogleUser(verifiedProfile) {
  const { sub, name, email } = verifiedProfile;

  // Recherche par le `sub` Google stable et immuable
  let user = users.find(u => u.google_sub === sub);
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = {
      id: nextUserId++,
      google_sub: sub,
      name: name || 'Utilisateur Google',
      email: email || null,
      is_admin: shouldGrantAdmin(sub, email),
      is_suspended: false,
      created_at: new Date().toISOString()
    };
    users.push(user);
  } else {
    if (user.is_suspended) {
      const err = new Error('Ce compte a été suspendu par l’administration.');
      err.status = 403;
      throw err;
    }
    // Mise à jour des métadonnées de profil tout en conservant le même compte et ID
    if (name) user.name = name;
    if (email) user.email = email;
    if (shouldGrantAdmin(sub, email)) {
      user.is_admin = true;
    }
  }

  return { user, isNewUser };
}

const initialStations = [
  // Mukaza
  { id: 1, name: 'Kimoil Fuel Stop', brand: 'Kimoil', zone: 'Centre-Ville', commune: 'Mukaza', location_text: 'Boulevard de l\'Uprona, Centre-Ville', landmark: 'Boulevard de l\'Uprona', fuels: 'Essence,Diesel', is_active: true, is_verified: true, verified_label: 'Station vérifiée', created_at: new Date().toISOString() },
  { id: 2, name: 'InterPetrol Brasserie', brand: 'InterPetrol', zone: 'Ngagara', commune: 'Mukaza', location_text: 'Mukaza, Bujumbura', landmark: 'Près de l\'hôpital CENTRE DE SOINS BRARUDI', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 3, name: 'STATION VIP', brand: 'VIP', zone: 'Rohero', commune: 'Mukaza', location_text: 'Rohero, Mukaza', landmark: 'Près de Regideso Dir. Commerciale', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 4, name: 'Station King Star', brand: 'King Star', zone: 'Rohero', commune: 'Mukaza', location_text: 'Avenue de la JRR, Rohero', landmark: 'Avenue de la JRR', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 5, name: 'InterPetrol Musée Vivant', brand: 'InterPetrol', zone: 'Rohero', commune: 'Mukaza', location_text: 'Rohero, Mukaza', landmark: 'Près du Musée Vivant', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 6, name: 'InterPetrol Energy Marché Central', brand: 'InterPetrol', zone: 'Centre-Ville', commune: 'Mukaza', location_text: 'Centre-Ville, Mukaza', landmark: 'Près du Marché Central', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  
  // Muha
  { id: 7, name: 'Yakeime Oil Kinindo', brand: 'Yakeime', zone: 'Kinindo', commune: 'Muha', location_text: 'Kinindo, Muha', landmark: 'Avenue du Large', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 8, name: 'Delta Kibenga', brand: 'Delta', zone: 'Kibenga', commune: 'Muha', location_text: 'Kibenga, Muha', landmark: 'Route Nationale 3', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 9, name: 'InterPetrol Kibenga', brand: 'InterPetrol', zone: 'Kibenga', commune: 'Muha', location_text: 'Kibenga, Muha', landmark: 'RN3 près du pont Kanyosha', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 10, name: 'Station Safari City Kanyosha', brand: 'Safari City', zone: 'Kanyosha', commune: 'Muha', location_text: 'Kanyosha, Muha', landmark: 'Avenue Gisyo', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 11, name: 'Mogas Ex-King Star Kanyosha', brand: 'Mogas', zone: 'Kanyosha', commune: 'Muha', location_text: 'Kanyosha, Muha', landmark: 'RN3 Kanyosha', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 12, name: 'InterPetrol Energy Kanyosha', brand: 'InterPetrol', zone: 'Kanyosha', commune: 'Muha', location_text: 'Kanyosha, Muha', landmark: 'Près du marché de Kanyosha', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 13, name: 'Mezzo Oil Kanyosha', brand: 'Mezzo Oil', zone: 'Kanyosha', commune: 'Muha', location_text: 'Kanyosha, Muha', landmark: 'Avenue de la paix Kanyosha', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 14, name: 'Kobil Kizingwe', brand: 'Kobil', zone: 'Kizingwe', commune: 'Muha', location_text: 'Kizingwe, Muha', landmark: 'Avenue Kizingwe', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 15, name: 'Safali Oil Kizingwe', brand: 'Safali Oil', zone: 'Kizingwe', commune: 'Muha', location_text: 'Kizingwe, Muha', landmark: 'Près de l\'école fondamentale de Kizingwe', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 16, name: 'Station Noe Ruziba', brand: 'Noe', zone: 'Ruziba', commune: 'Muha', location_text: 'Ruziba, Muha', landmark: 'RN3 axe Bujumbura-Rumonge', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 17, name: 'Geprotis Ruziba', brand: 'Geprotis', zone: 'Ruziba', commune: 'Muha', location_text: 'Ruziba Rural, Muha', landmark: 'Ruziba Rural', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 18, name: 'Mega Oil Ruziba', brand: 'Mega Oil', zone: 'Ruziba', commune: 'Muha', location_text: 'Ruziba, Muha', landmark: 'Près du poste de police de Ruziba', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 19, name: 'Station Gare du Sud', brand: 'Gare du Sud', zone: 'Gare du Sud', commune: 'Muha', location_text: 'Gare du Sud, Muha', landmark: 'Terminus des bus Gare du Sud', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 20, name: 'Mogas Aupare', brand: 'Mogas', zone: 'Aupare', commune: 'Muha', location_text: 'Aupare, Muha', landmark: 'Quartier Aupare', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 21, name: 'Station Quick Service Musaga', brand: 'Quick Service', zone: 'Musaga', commune: 'Muha', location_text: 'Musaga, Muha', landmark: 'Boulevard de la Liberté', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 22, name: 'InterPetrol Energy Musaga', brand: 'InterPetrol', zone: 'Musaga', commune: 'Muha', location_text: 'Musaga, Muha', landmark: 'Avenue du Large vers Musaga', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 23, name: 'Lybajas Musaga', brand: 'Lybajas', zone: 'Musaga', commune: 'Muha', location_text: 'Musaga, Muha', landmark: 'Avenue Kiriri', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 24, name: 'Safari Oil Musaga', brand: 'Safari Oil', zone: 'Musaga', commune: 'Muha', location_text: 'Musaga, Muha', landmark: 'Entrée Musaga', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 25, name: 'Petro Muha de Musaga', brand: 'Petro Muha', zone: 'Musaga', commune: 'Muha', location_text: 'Musaga, Muha', landmark: 'Rond-point Musaga', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },

  // Ntahangwa
  { id: 26, name: 'Kigobe City Oil', brand: 'City Oil', zone: 'Kigobe', commune: 'Ntahangwa', location_text: 'Kigobe, Ntahangwa', landmark: 'Boulevard du 28 Novembre', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 27, name: 'InterPetrol Cibitoke', brand: 'InterPetrol', zone: 'Cibitoke', commune: 'Ntahangwa', location_text: 'Cibitoke, Ntahangwa', landmark: 'Boulevard du 28 Novembre angle 10ème', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() },
  { id: 28, name: 'Kobil Kanyaru', brand: 'Kobil', zone: 'Kanyaru', commune: 'Ntahangwa', location_text: 'Kanyaru, Ntahangwa', landmark: 'RN1 sortie nord', fuels: 'Essence,Diesel', is_active: true, is_verified: false, created_at: new Date().toISOString() }
];
const stations = [...initialStations];

const reports = [
  {
    id: 1,
    station_id: 1,
    user_id: 1,
    fuel_status: 'distribution',
    fuel_type: 'both',
    queue_status: 'short',
    approximate_count: '10-30',
    station_open: 'yes',
    comment: 'Pompes en service pour essence et mazout. Service fluide.',
    photo_path: null,
    is_live_capture: false,
    created_at: new Date(Date.now() - 15 * 60000).toISOString(),
    is_deleted: false
  },
  {
    id: 2,
    station_id: 6,
    user_id: 1,
    fuel_status: 'no_fuel',
    fuel_type: 'unspecified',
    queue_status: 'none',
    approximate_count: 'unknown',
    station_open: 'no',
    comment: 'Pas de carburant ce matin.',
    photo_path: null,
    is_live_capture: false,
    created_at: new Date(Date.now() - 35 * 60000).toISOString(),
    is_deleted: false
  }
];

const confirmations = [
  { id: 1, report_id: 1, user_id: 1, kind: 'confirm', created_at: new Date().toISOString() }
];

const abuseReports = [];
const zoneSubscriptions = [];
const stationClaims = [];
const actionLogs = [
  {
    id: 1,
    admin_id: 1,
    admin_name: 'Tedd Greg',
    action: 'Démarrage du système',
    target_type: 'system',
    target_id: 0,
    details: 'Initialisation de la base de données opérationnelle avec 28 stations',
    created_at: new Date().toISOString()
  }
];

const statusLabels = {
  distribution: 'On distribue',
  no_fuel: 'Pas de carburant',
  starting: 'Ça semble commencer',
  unknown: 'Pas d’information récente'
};

const fuelTypeLabels = {
  essence: 'Essence',
  mazout: 'Mazout',
  both: 'Essence & Mazout',
  unspecified: 'Non précisé'
};

function logAction(req, action, targetType, targetId, details) {
  const admin = getCurrentUser(req);
  actionLogs.push({
    id: actionLogs.length + 1,
    admin_id: admin ? admin.id : null,
    admin_name: admin ? admin.name : 'Système',
    action,
    target_type: targetType,
    target_id: targetId,
    details,
    created_at: new Date().toISOString()
  });
}

// Aggregator
function freshness(dateStr) {
  const dt = new Date(dateStr);
  const diffMinutes = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 60000));
  if (diffMinutes < 5) return 'À l’instant';
  if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
  if (diffMinutes < 1440) return `Il y a ${Math.floor(diffMinutes / 60)} h`;
  return 'Information ancienne';
}

function aggregate(station) {
  const windowMinutes = 120;
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const activeReports = reports
    .filter(r => r.station_id === station.id && !r.is_deleted && new Date(r.created_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (activeReports.length === 0) {
    return {
      status: 'unknown',
      fuel_type: 'unspecified',
      queue: 'unknown',
      freshness: 'Aucun signalement récent',
      report: null,
      confirmations: 0,
      contradictions: 0
    };
  }

  const latest = activeReports[0];
  const confs = confirmations.filter(c => c.report_id === latest.id);
  const confirmCount = confs.filter(c => c.kind === 'confirm').length;
  const contradictCount = confs.filter(c => c.kind === 'no_longer_true').length;

  return {
    status: latest.fuel_status,
    fuel_type: latest.fuel_type || 'unspecified',
    queue: latest.queue_status,
    freshness: freshness(latest.created_at),
    report: latest,
    confirmations: confirmCount,
    contradictions: contradictCount
  };
}

function getCurrentUser(req) {
  const uid = req.session ? req.session.user_id : null;
  if (!uid) return null;
  const u = users.find(x => x.id === uid);
  if (!u || u.is_suspended) return null;
  return u;
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Authentification Google requise. Veuillez vous connecter dans l’onglet Profil.' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user || !user.is_admin) {
    return res.status(403).json({ detail: 'Accès administrateur requis' });
  }
  req.user = user;
  next();
}

const shareMetrics = {
  share_opened: 0,
  share_channel_selected: 0,
  share_generated: 0,
  share_native_started: 0,
  share_fallback_used: 0,
  by_channel: {}
};

function getPublicShareOrigin(req) {
  const configured = (process.env.PUBLIC_SHARE_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    return configured;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] || req.get('host') || '').trim();
  if (
    host &&
    !host.startsWith('localhost') &&
    !host.startsWith('127.0.0.1') &&
    !host.startsWith('0.0.0.0')
  ) {
    return `${proto}://${host}`;
  }
  return 'https://igitorolive.up.railway.app';
}

function ctx(req) {
  const publicOrigin = getPublicShareOrigin(req);
  return {
    user: getCurrentUser(req),
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    publicOrigin,
    canonicalUrl: `${publicOrigin}${req.path || '/'}`
  };
}

function getRedirectUri(req) {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/auth/callback`;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/auth/callback`;
}

// ================= Web Routes =================
app.get('/', (req, res) => {
  const activeStations = stations
    .filter(s => s.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));

  const list = activeStations.map(s => ({
    station: s,
    state: aggregate(s)
  }));

  res.render('home', {
    ...ctx(req),
    stations: list,
    statusLabels,
    fuelTypeLabels
  });
});

app.get('/stations/:id', (req, res) => {
  const stationId = parseInt(req.params.id, 10);
  const s = stations.find(x => x.id === stationId && x.is_active);
  const stationReports = reports
    .filter(r => r.station_id === stationId && !r.is_deleted)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 30)
    .map(r => {
      const confs = confirmations.filter(c => c.report_id === r.id);
      return {
        ...r,
        confirmCount: confs.filter(c => c.kind === 'confirm').length,
        contradictCount: confs.filter(c => c.kind === 'no_longer_true').length
      };
    });

  res.render('station', {
    ...ctx(req),
    station: s || null,
    state: s ? aggregate(s) : null,
    reports: stationReports,
    statusLabels,
    fuelTypeLabels
  });
});

app.get('/signaler', (req, res) => {
  const activeStations = stations
    .filter(s => s.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));

  res.render('report', {
    ...ctx(req),
    stations: activeStations
  });
});

app.get('/notifications', (req, res) => {
  const user = getCurrentUser(req);
  const subs = user
    ? new Set(zoneSubscriptions.filter(z => z.user_id === user.id).map(z => z.zone))
    : new Set();

  const allZones = Array.from(new Set(stations.map(s => s.zone).filter(Boolean))).sort();

  const now = Date.now();
  const past48h = now - 48 * 3600 * 1000;
  const recentReports = reports
    .filter(r => !r.is_deleted && new Date(r.created_at).getTime() >= past48h)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const zoneMap = new Map();
  recentReports.forEach(r => {
    const st = stations.find(s => s.id === r.station_id);
    if (!st || !st.zone) return;
    if (!zoneMap.has(st.zone)) {
      zoneMap.set(st.zone, {
        zone: st.zone,
        reports: [],
        latestDate: r.created_at
      });
    }
    const entry = zoneMap.get(st.zone);
    if (!entry.reports.some(x => x.name === st.name)) {
      entry.reports.push({
        name: st.name,
        statusLabel: statusLabels[r.fuel_status] || r.fuel_status,
        fuel_status: r.fuel_status
      });
    }
  });

  const groupedAlerts = Array.from(zoneMap.values()).map(z => {
    const withFuel = z.reports.filter(x => x.fuel_status === 'distribution' || x.fuel_status === 'starting').length;
    let summary = '';
    if (withFuel > 0) {
      summary = `Activité à ${z.zone} : ${withFuel} station${withFuel > 1 ? 's ont' : ' a'} du carburant signalé disponible.`;
    } else {
      summary = `Derniers signalements à ${z.zone} pour ${z.reports.length} station${z.reports.length > 1 ? 's' : ''}.`;
    }
    return {
      zone: z.zone,
      freshness: freshness(z.latestDate),
      summary,
      stations: z.reports
    };
  });

  res.render('notifications', {
    ...ctx(req),
    zones: allZones,
    subscribed: subs,
    groupedAlerts
  });
});

app.get('/profil', (req, res) => {
  const user = getCurrentUser(req);
  const userReports = user
    ? reports
        .filter(r => r.user_id === user.id && !r.is_deleted)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 30)
        .map(r => ({
          ...r,
          station: stations.find(s => s.id === r.station_id)
        }))
    : [];

  const subs = user ? zoneSubscriptions.filter(z => z.user_id === user.id) : [];

  res.render('profile', {
    ...ctx(req),
    reports: userReports,
    subscriptions: subs
  });
});

app.get('/admin', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || !user.is_admin) {
    return res.redirect('/profil');
  }

  const now = Date.now();
  const past24h = now - 24 * 3600 * 1000;
  const recentReports24h = reports.filter(r => !r.is_deleted && new Date(r.created_at).getTime() >= past24h).length;

  const totalConfirmations = confirmations.filter(c => c.kind === 'confirm').length;
  const totalContradictions = confirmations.filter(c => c.kind === 'no_longer_true').length;

  const stats = {
    totalStations: stations.length,
    activeStations: stations.filter(s => s.is_active).length,
    totalReports: reports.filter(r => !r.is_deleted).length,
    recentReports24h,
    totalConfirmations,
    totalContradictions,
    pendingClaims: stationClaims.filter(c => c.status === 'pending').length,
    pendingAbuse: abuseReports.filter(a => a.status === 'pending').length,
    totalUsers: users.length,
    suspendedUsers: users.filter(u => u.is_suspended).length
  };

  res.render('admin', {
    ...ctx(req),
    stats,
    stations,
    claims: stationClaims,
    abuseList: abuseReports,
    allReports: reports,
    userList: users,
    logs: actionLogs
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes racines pour PWA, manifest et icônes d'écran d'accueil (iOS / Android)
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'static', 'sw.js'));
});

app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'icons', 'icon-180.png'));
});

app.get('/favicon.ico', (req, res) => {
  res.type('image/png');
  res.sendFile(path.join(__dirname, 'static', 'icons', 'favicon-32.png'));
});

app.get('/og-share.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/png');
  res.sendFile(path.join(__dirname, 'static', 'icons', 'og-share.png'));
});

// ================= Système de Partage Complet (/partager & /share) =================
function resolveValidatedShareContext(req) {
  const activeStations = stations
    .filter(s => s.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const allZones = Array.from(new Set(activeStations.map(s => s.zone).filter(Boolean))).sort();

  const rawStationId = parseInt(req.query.station_id || req.query.station || '', 10);
  const rawZone = String(req.query.zone || '')
    .replace(/[<>]/g, '')
    .trim();

  let initialContextType = 'general';
  let selectedStation = null;
  let selectedZone = '';
  let backUrl = '/';
  let shareTitle = 'Partager Igitoro Live — Tu cherches. Tu observes. Tu aides.';
  let shareDescription = 'Aidez quelqu’un à trouver du carburant à Bujumbura et faites circuler les observations utiles de la communauté.';

  if (Number.isInteger(rawStationId) && rawStationId > 0) {
    const foundStation = activeStations.find(s => s.id === rawStationId);
    if (foundStation) {
      initialContextType = 'station';
      selectedStation = {
        id: foundStation.id,
        name: foundStation.name,
        zone: foundStation.zone,
        commune: foundStation.commune,
        brand: foundStation.brand || ''
      };
      backUrl = `/stations/${foundStation.id}`;
      shareTitle = `${foundStation.name} (${foundStation.zone}) — Partager sur Igitoro Live`;
      shareDescription = `Tu cherches. Tu observes. Tu aides. Consultez ou partagez les dernières observations communautaires pour la station ${foundStation.name} (${foundStation.zone}).`;
    }
  } else if (rawZone && allZones.includes(rawZone)) {
    initialContextType = 'zone';
    selectedZone = rawZone;
    backUrl = '/notifications';
    shareTitle = `Quartier ${rawZone} — Partager sur Igitoro Live`;
    shareDescription = `Tu cherches. Tu observes. Tu aides. Suivez ou partagez les observations communautaires sur les stations-service à ${rawZone} (Bujumbura).`;
  }

  return {
    activeStations: activeStations.map(s => ({
      id: s.id,
      name: s.name,
      zone: s.zone,
      commune: s.commune,
      brand: s.brand || ''
    })),
    allZones,
    initialContextType,
    selectedStation,
    selectedZone,
    backUrl,
    shareTitle,
    shareDescription
  };
}

app.get(['/partager', '/share'], (req, res) => {
  const shareCtx = resolveValidatedShareContext(req);
  res.render('share', {
    ...ctx(req),
    stations: shareCtx.activeStations,
    zones: shareCtx.allZones,
    initialContextType: shareCtx.initialContextType,
    selectedStation: shareCtx.selectedStation,
    selectedZone: shareCtx.selectedZone,
    backUrl: shareCtx.backUrl,
    shareTitle: shareCtx.shareTitle,
    shareDescription: shareCtx.shareDescription
  });
});

app.get('/api/share/context', (req, res) => {
  const shareCtx = resolveValidatedShareContext(req);
  const publicOrigin = getPublicShareOrigin(req);
  let targetUrl = `${publicOrigin}/`;
  if (shareCtx.initialContextType === 'station' && shareCtx.selectedStation) {
    targetUrl = `${publicOrigin}/stations/${shareCtx.selectedStation.id}`;
  } else if (shareCtx.initialContextType === 'zone' && shareCtx.selectedZone) {
    targetUrl = `${publicOrigin}/?q=${encodeURIComponent(shareCtx.selectedZone)}`;
  }

  res.json({
    context_type: shareCtx.initialContextType,
    station: shareCtx.selectedStation,
    zone: shareCtx.selectedZone || null,
    public_origin: publicOrigin,
    target_url: targetUrl,
    title: shareCtx.shareTitle,
    description: shareCtx.shareDescription,
    motto: 'Tu cherches. Tu observes. Tu aides.'
  });
});

app.post('/api/share/event', (req, res) => {
  const allowedEvents = new Set([
    'share_opened',
    'share_channel_selected',
    'share_generated',
    'share_native_started',
    'share_fallback_used'
  ]);
  const ev = String((req.body && req.body.event) || '').trim();
  const ch = String((req.body && req.body.channel) || '')
    .replace(/[^a-z0-9_]/gi, '')
    .slice(0, 32);

  if (!allowedEvents.has(ev)) {
    return res.status(400).json({ detail: 'Événement de partage non reconnu' });
  }
  shareMetrics[ev] = (shareMetrics[ev] || 0) + 1;
  if (ch) {
    shareMetrics.by_channel[ch] = (shareMetrics.by_channel[ch] || 0) + 1;
  }
  res.json({ ok: true, metrics: shareMetrics });
});

// ================= API: Google Maps Grounding =================
const mapsGroundingCache = new Map();

function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

app.post('/api/maps/grounding', async (req, res) => {
  try {
    const body = req.body || {};
    const stationId = body.station_id ? parseInt(body.station_id, 10) : null;
    const rawQuery = String(body.query || '').trim();
    const station = stationId ? stations.find(s => s.id === stationId) : null;

    // Coordonnées GPS de l'utilisateur ou centre de Bujumbura (-3.3822, 29.3644)
    const lat = Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : -3.3822;
    const lng = Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : 29.3644;

    const searchTarget = station
      ? `${station.name} (${station.brand || 'Station-service'}), quartier ${station.zone}, commune ${station.commune || 'Bujumbura'}, ${station.location_text || ''}, Bujumbura, Burundi`
      : rawQuery || 'Stations-service à Bujumbura, Burundi';

    const fallbackMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      station ? `${station.name} ${station.zone} Bujumbura Burundi` : `${rawQuery || 'Station service'} Bujumbura Burundi`
    )}`;

    const cacheKey = `${stationId || ''}:${rawQuery.toLowerCase()}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
    const cached = mapsGroundingCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 15 * 60 * 1000) {
      return res.json(cached.data);
    }

    const defaultPayload = {
      ok: true,
      text: station
        ? `📍 ${station.name} (${station.brand || 'Station-service'}) est située à ${station.zone} (commune ${station.commune || 'Bujumbura'}) — ${station.location_text}${station.landmark ? ` · Repère : ${station.landmark}` : ''}. Consultez le lien Google Maps ci-dessous pour afficher l'itinéraire exact.`
        : `Recherche Google Maps pour « ${rawQuery || 'Stations-service à Bujumbura'} ». Ouvrez le lien ci-dessous dans Google Maps.`,
      places: [
        {
          title: station ? `${station.name} (${station.zone}) — Google Maps` : `${rawQuery || 'Stations-service Bujumbura'} — Google Maps`,
          uri: fallbackMapUrl
        }
      ],
      reviewSnippets: [],
      fallbackMapUrl
    };

    const ai = getGeminiClient();
    if (!ai) {
      return res.json(defaultPayload);
    }

    const prompt = station
      ? `Donne des informations géographiques précises et utiles en français (accès, avenues proches, points de repère connus à Bujumbura) pour la station-service suivante : ${searchTarget}. Reste concis (3 à 5 phrases claires) et ne promets jamais de disponibilité de stock de carburant.`
      : `En français, aide un automobiliste à Bujumbura (Burundi) pour la recherche suivante sur Google Maps : "${searchTarget}". Indique les emplacements, avenues, quartiers et points de repère utiles de manière concise (3 à 5 phrases).`;

    const requestConfig = {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: {
          latLng: {
            latitude: lat,
            longitude: lng
          }
        }
      }
    };

    let response = null;
    for (const modelName of ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest']) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: requestConfig
        });
        if (response) break;
      } catch (_) {}
    }

    if (!response) {
      return res.json(defaultPayload);
    }

    const text = response.text || '';
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const places = [];
    const reviewSnippets = [];

    for (const chunk of chunks) {
      if (chunk && chunk.maps) {
        if (chunk.maps.uri) {
          places.push({
            title: chunk.maps.title || 'Voir sur Google Maps',
            uri: chunk.maps.uri
          });
        }
        const snippets = chunk.maps.placeAnswerSources?.reviewSnippets;
        if (Array.isArray(snippets)) {
          for (const s of snippets) {
            if (s && (s.content || s.text || s.uri)) {
              reviewSnippets.push({
                text: s.content || s.text || 'Avis Google Maps',
                uri: s.uri || chunk.maps.uri || fallbackMapUrl
              });
            }
          }
        }
      }
    }

    if (places.length === 0) {
      places.push({
        title: station ? `${station.name} (${station.zone}) — Ouvrir dans Google Maps` : `Voir « ${rawQuery || 'Stations Bujumbura'} » sur Google Maps`,
        uri: fallbackMapUrl
      });
    }

    const resultPayload = {
      ok: true,
      text,
      places,
      reviewSnippets,
      fallbackMapUrl
    };
    mapsGroundingCache.set(cacheKey, { ts: Date.now(), data: resultPayload });
    res.json(resultPayload);
  } catch (err) {
    res.status(500).json({
      detail: err.message || 'Erreur lors de la récupération des données Google Maps.'
    });
  }
});

// ================= API: Stations =================
app.get('/api/stations', (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase().trim();
  let list = stations.filter(s => s.is_active);
  if (q) {
    list = list.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.zone.toLowerCase().includes(q) ||
        (s.commune && s.commune.toLowerCase().includes(q)) ||
        (s.brand && s.brand.toLowerCase().includes(q))
    );
  }
  const result = list.slice(0, 30).map(s => ({
    id: s.id,
    name: s.name,
    brand: s.brand,
    zone: s.zone,
    commune: s.commune,
    location: s.location_text,
    state: aggregate(s)
  }));
  res.json(result);
});

app.get('/api/stations/:id', (req, res) => {
  const s = stations.find(x => x.id === parseInt(req.params.id, 10) && x.is_active);
  if (!s) return res.status(404).json({ detail: 'Station introuvable' });
  res.json({
    id: s.id,
    name: s.name,
    brand: s.brand,
    zone: s.zone,
    commune: s.commune,
    location: s.location_text,
    landmark: s.landmark,
    fuels: s.fuels,
    is_verified: !!s.is_verified,
    state: aggregate(s)
  });
});

app.post('/api/stations', requireAuth, (req, res) => {
  if (!limiter.allow(`st_add:${req.user.id}`, 1)) {
    return res.status(429).json({ detail: 'Trop de propositions de stations récemment. Veuillez patienter.' });
  }

  const payload = req.body || {};
  if (!payload.name || !payload.zone || !payload.location_text) {
    return res.status(400).json({ detail: 'Champs obligatoires manquants (nom, quartier, localisation)' });
  }
  const station = {
    id: nextStationId++,
    name: payload.name.trim(),
    brand: payload.brand ? payload.brand.trim() : null,
    commune: payload.commune ? payload.commune.trim() : 'Mukaza',
    zone: payload.zone.trim(),
    location_text: payload.location_text.trim(),
    landmark: payload.landmark ? payload.landmark.trim() : null,
    fuels: payload.fuels || 'Essence,Diesel',
    is_active: true,
    is_verified: false,
    created_at: new Date().toISOString()
  };
  stations.push(station);
  logAction(req, 'Station proposée par la communauté', 'station', station.id, `${station.name} (${station.zone})`);
  res.json({ ok: true, station_id: station.id });
});

// Revendication d'une station par un gérant/représentant
app.post('/api/stations/:id/claim', requireAuth, (req, res) => {
  const stationId = parseInt(req.params.id, 10);
  const s = stations.find(x => x.id === stationId && x.is_active);
  if (!s) return res.status(404).json({ detail: 'Station introuvable' });

  if (!limiter.allow(`claim:${req.user.id}`, 2)) {
    return res.status(429).json({ detail: 'Trop de demandes de revendication soumises' });
  }

  const { contact_name, phone, role, proof_details } = req.body || {};
  if (!contact_name || !phone || !role) {
    return res.status(400).json({ detail: 'Nom, téléphone et rôle obligatoires' });
  }

  const claim = {
    id: nextClaimId++,
    station_id: stationId,
    user_id: req.user.id,
    contact_name: contact_name.trim(),
    phone: phone.trim(),
    role: role.trim(),
    proof_details: (proof_details || '').trim(),
    status: 'pending',
    created_at: new Date().toISOString()
  };
  stationClaims.push(claim);

  logAction(req, 'Demande de revendication', 'station', stationId, `Déposée par ${contact_name} (${role})`);
  res.json({ ok: true, claim_id: claim.id });
});

// ================= API: Reports =================
app.post('/api/reports', requireAuth, upload.single('photo'), (req, res) => {
  const user = req.user;

  if (!limiter.allow(`r:${user.id}`)) {
    return res.status(429).json({ detail: 'Trop de signalements récemment. Veuillez patienter.' });
  }

  const stationId = parseInt(req.body.station_id, 10);
  const station = stations.find(s => s.id === stationId);
  if (!station) {
    return res.status(404).json({ detail: 'Station introuvable' });
  }

  const fuel_status = req.body.fuel_status || 'unknown';
  const fuel_type = req.body.fuel_type || 'unspecified';
  const queue_status = req.body.queue_status || 'unknown';
  const approximate_count = req.body.approximate_count || 'unknown';
  const station_open = req.body.station_open || 'unknown';
  const comment = (req.body.comment || '').trim() || null;
  
  let photo_path = null;
  let is_live_capture = false;
  if (req.file) {
    const capturedAtRaw = req.body.photo_captured_at;
    const capturedAt = capturedAtRaw ? parseInt(capturedAtRaw, 10) : null;
    const now = Date.now();

    // Règle stricte anti-fraude : la photo doit être capturée en direct par la caméra à l'instant même
    if (!capturedAt || Math.abs(now - capturedAt) > 5 * 60 * 1000) {
      try {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (err) {}
      return res.status(400).json({ 
        detail: "Photo refusée : Aucune photo de galerie ou disque dur n'est acceptée. La photo doit être prise directement sur le moment avec la caméra." 
      });
    }

    photo_path = `/static/uploads/${req.file.filename}`;
    is_live_capture = true;
  }

  const report = {
    id: nextReportId++,
    station_id: stationId,
    user_id: user.id,
    fuel_status,
    fuel_type,
    queue_status,
    approximate_count,
    station_open,
    comment,
    photo_path,
    is_live_capture,
    created_at: new Date().toISOString(),
    is_deleted: false
  };
  reports.push(report);

  res.json({ ok: true, report_id: report.id });
});

app.post('/api/reports/:id/verify', requireAuth, (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  const r = reports.find(x => x.id === reportId && !x.is_deleted);
  if (!r) return res.status(404).json({ detail: 'Signalement introuvable' });

  const kind = req.body.kind;
  if (kind !== 'confirm' && kind !== 'no_longer_true') {
    return res.status(400).json({ detail: 'Type d’évaluation invalide' });
  }

  let c = confirmations.find(x => x.report_id === reportId && x.user_id === req.user.id);
  if (c) {
    c.kind = kind;
  } else {
    confirmations.push({
      id: nextConfirmationId++,
      report_id: reportId,
      user_id: req.user.id,
      kind,
      created_at: new Date().toISOString()
    });
  }
  res.json({ ok: true });
});

app.delete('/api/reports/:id', requireAuth, (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  const r = reports.find(x => x.id === reportId);
  if (!r || (r.user_id !== req.user.id && !req.user.is_admin)) {
    return res.status(404).json({ detail: 'Signalement introuvable ou non autorisé' });
  }
  r.is_deleted = true;
  res.json({ ok: true });
});

app.post('/api/reports/:id/abuse', requireAuth, (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  const r = reports.find(x => x.id === reportId);
  if (!r) return res.status(404).json({ detail: 'Signalement introuvable' });

  if (!limiter.allow(`a:${req.user.id}`, 1)) {
    return res.status(429).json({ detail: 'Trop de signalements de modération soumis' });
  }

  abuseReports.push({
    id: nextAbuseId++,
    report_id: reportId,
    user_id: req.user.id,
    reason: req.body.reason || 'Autre',
    details: (req.body.details || '').trim() || null,
    status: 'pending',
    created_at: new Date().toISOString()
  });

  res.json({ ok: true });
});

// ================= API: Auth (Google OAuth 2.0 / OpenID Connect) =================

// 1. Générer l'URL d'autorisation OAuth 2.0 / OpenID Connect de Google
app.get('/api/auth/google/url', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      detail: 'La variable GOOGLE_CLIENT_ID doit être configurée sur le serveur pour activer Google OAuth 2.0.'
    });
  }

  const redirectUri = req.query.redirect_uri
    ? String(req.query.redirect_uri)
    : getRedirectUri(req);

  const state = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  req.session.oauth_state = state;
  req.session.oauth_redirect_uri = redirectUri;

  const hasSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_SECRET.trim());
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: hasSecret ? 'code' : 'id_token',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account'
  });

  res.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  });
});

// 2. Callback OAuth 2.0 / OpenID Connect après redirection Google
const handleGoogleCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.status(400).send('Authentification Google annulée ou refusée.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const redirectUri = req.session.oauth_redirect_uri || getRedirectUri(req);

    // Si aucun code n'est dans la query string, Google a renvoyé #id_token=... dans le fragment d'URL (flux OIDC id_token sans secret)
    if (!code) {
      return res.send(`<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Vérification Google OIDC - Igitoro Live</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 40px; color: #1A3C2A;">
  <p id="status-msg">Vérification sécurisée de votre compte Google…</p>
  <script>
    (async function() {
      const hash = window.location.hash ? window.location.hash.substring(1) : '';
      const params = new URLSearchParams(hash);
      const idToken = params.get('id_token');
      const statusEl = document.getElementById('status-msg');
      if (!idToken) {
        statusEl.textContent = 'Jeton Google manquant. Redirection…';
        setTimeout(() => { window.location.href = '/profil'; }, 1200);
        return;
      }
      try {
        const r = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: idToken })
        });
        const d = await r.json();
        if (r.ok) {
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
            window.close();
          } else {
            window.location.href = '/profil';
          }
        } else {
          statusEl.textContent = d.detail || 'Échec de la vérification Google OIDC.';
        }
      } catch (e) {
        statusEl.textContent = 'Erreur réseau lors de la vérification Google.';
      }
    })();
  </script>
</body>
</html>`);
    }

    // Si un code OAuth 2.0 est présent mais que GOOGLE_CLIENT_SECRET n'est pas configuré, basculer automatiquement vers le flux OIDC id_token
    if (!clientSecret && clientId) {
      const fallbackParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'id_token',
        scope: 'openid email profile',
        state: String(state || crypto.randomBytes(16).toString('hex')),
        nonce: crypto.randomBytes(16).toString('hex'),
        prompt: 'select_account'
      });
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${fallbackParams.toString()}`);
    }

    if (req.session.oauth_state && state !== req.session.oauth_state) {
      return res.status(401).json({ detail: 'État OAuth 2.0 (state CSRF) invalide' });
    }
    delete req.session.oauth_state;

    const client = new OAuth2Client(clientId, clientSecret, redirectUri);
    const { tokens } = await client.getToken(String(code));

    if (!tokens || !tokens.id_token) {
      return res.status(401).json({ detail: 'Aucun id_token OpenID Connect reçu de Google' });
    }

    const verifiedProfile = await verifyGoogleOidcToken(tokens.id_token);
    const { user } = findOrCreateGoogleUser(verifiedProfile);
    req.session.user_id = user.id;

    res.send(`<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Connexion réussie - Igitoro Live</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 40px;">
  <p>Authentification Google réussie. Redirection en cours…</p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
      window.close();
    } else {
      window.location.href = '/profil';
    }
  </script>
</body>
</html>`);
  } catch (err) {
    const status = err.status || 401;
    res.status(status).json({ detail: err.message || 'Échec de la vérification Google OAuth 2.0' });
  }
};

app.get(['/auth/callback', '/auth/callback/', '/api/auth/google/callback'], handleGoogleCallback);

// 3. Vérification directe d'un ID Token Google OpenID Connect (Google Identity Services)
app.post('/api/auth/google', async (req, res) => {
  try {
    const payload = req.body || {};
    const credential = payload.credential || payload.id_token || '';

    const verifiedProfile = await verifyGoogleOidcToken(credential);
    const { user, isNewUser } = findOrCreateGoogleUser(verifiedProfile);

    req.session.user_id = user.id;
    res.json({
      ok: true,
      is_new_user: isNewUser,
      user: {
        id: user.id,
        sub: user.google_sub,
        name: user.name,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    const status = err.status || 401;
    res.status(status).json({ detail: err.message || 'Jeton Google invalide' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    return res.json({ ok: true });
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.delete('/api/auth/account', requireAuth, (req, res) => {
  req.user.name = 'Compte supprimé';
  req.user.email = null;
  req.user.google_sub = `deleted-${req.user.id}-${Date.now()}`;
  req.user.is_suspended = true;

  // Nettoyer les abonnements de cet utilisateur
  for (let i = zoneSubscriptions.length - 1; i >= 0; i--) {
    if (zoneSubscriptions[i].user_id === req.user.id) {
      zoneSubscriptions.splice(i, 1);
    }
  }

  logAction(req, 'Compte supprimé', 'user', req.user.id, 'Anonymisation des données utilisateur');

  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ================= API: Notifications =================
app.get('/api/notifications', requireAuth, (req, res) => {
  const subs = zoneSubscriptions.filter(z => z.user_id === req.user.id);
  const recent = reports
    .filter(r => !r.is_deleted)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map(r => {
      const st = stations.find(s => s.id === r.station_id);
      return {
        id: r.id,
        station: st ? st.name : 'Station',
        zone: st ? st.zone : '',
        created_at: r.created_at
      };
    });

  res.json({
    subscriptions: subs.map(x => x.zone),
    recent
  });
});

app.post('/api/notifications/subscribe', requireAuth, (req, res) => {
  const zone = (req.body.zone || '').trim();
  if (!zone) return res.status(400).json({ detail: 'Quartier requis' });
  const exists = zoneSubscriptions.find(z => z.user_id === req.user.id && z.zone === zone);
  if (!exists) {
    zoneSubscriptions.push({
      id: nextSubId++,
      user_id: req.user.id,
      zone,
      created_at: new Date().toISOString()
    });
  }
  res.json({ ok: true, subscribed: true, zone });
});

app.post('/api/notifications/unsubscribe', requireAuth, (req, res) => {
  const zone = (req.body.zone || '').trim();
  const idx = zoneSubscriptions.findIndex(z => z.user_id === req.user.id && z.zone === zone);
  if (idx !== -1) {
    zoneSubscriptions.splice(idx, 1);
  }
  res.json({ ok: true, subscribed: false, zone });
});

// ================= API: Admin =================
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  res.json({
    users: users.length,
    stations: stations.length,
    reports: reports.length,
    pending_abuse: abuseReports.filter(a => a.status === 'pending').length,
    pending_claims: stationClaims.filter(c => c.status === 'pending').length
  });
});

app.post('/api/admin/stations', requireAdmin, (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.zone || !payload.location_text) {
    return res.status(400).json({ detail: 'Nom, zone et localisation obligatoires' });
  }

  const s = {
    id: nextStationId++,
    name: String(payload.name).trim(),
    brand: payload.brand ? String(payload.brand).trim() : null,
    commune: payload.commune ? String(payload.commune).trim() : 'Mukaza',
    zone: String(payload.zone).trim(),
    location_text: String(payload.location_text).trim(),
    landmark: payload.landmark ? String(payload.landmark).trim() : null,
    fuels: payload.fuels ? String(payload.fuels).trim() : 'Essence,Diesel',
    is_active: true,
    is_verified: true,
    verified_label: 'Créée par l\'administration',
    created_at: new Date().toISOString()
  };

  stations.push(s);
  logAction(req, 'Station officielle ajoutée', 'station', s.id, `${s.name} (${s.zone})`);

  const acceptsJson = (req.headers.accept || '').includes('application/json') || req.is('application/json');
  if (!acceptsJson) {
    return res.redirect('/admin');
  }
  res.json({ ok: true, station: s });
});

app.post('/api/admin/stations/:id/toggle', requireAdmin, (req, res) => {
  const s = stations.find(x => x.id === parseInt(req.params.id, 10));
  if (!s) return res.status(404).json({ detail: 'Station introuvable' });
  s.is_active = !s.is_active;
  logAction(req, s.is_active ? 'Station activée' : 'Station désactivée', 'station', s.id, s.name);
  res.json({ ok: true, active: s.is_active });
});

app.post('/api/admin/claims/:id/moderate', requireAdmin, (req, res) => {
  const claimId = parseInt(req.params.id, 10);
  const claim = stationClaims.find(c => c.id === claimId);
  if (!claim) return res.status(404).json({ detail: 'Demande introuvable' });

  const { action, reason } = req.body || {};
  if (action === 'approve') {
    claim.status = 'approved';
    const s = stations.find(x => x.id === claim.station_id);
    if (s) {
      s.is_verified = true;
      s.verified_label = 'Vérifiée par l\'administration';
      s.verified_by_user_id = claim.user_id;
      s.claimed_by_contact = `${claim.contact_name} (${claim.phone})`;
    }
    logAction(req, 'Revendication approuvée', 'station', claim.station_id, `Validé pour ${claim.contact_name} (${claim.role})`);
  } else if (action === 'reject') {
    claim.status = 'rejected';
    claim.rejection_reason = reason || null;
    logAction(req, 'Revendication rejetée', 'station', claim.station_id, `Rejet de ${claim.contact_name}`);
  } else {
    return res.status(400).json({ detail: 'Action invalide' });
  }

  res.json({ ok: true, status: claim.status });
});

app.post('/api/admin/abuse/:id/moderate', requireAdmin, (req, res) => {
  const a = abuseReports.find(x => x.id === parseInt(req.params.id, 10));
  if (!a) return res.status(404).json({ detail: 'Abus introuvable' });
  const action = req.body.action;

  if (action === 'hide_report') {
    const r = reports.find(x => x.id === a.report_id);
    if (r) r.is_deleted = true;
    a.status = 'resolved';
    a.action_taken = 'Signalement masqué';
    logAction(req, 'Signalement masqué pour abus', 'report', a.report_id, `Motif : ${a.reason}`);
  } else if (action === 'suspend_user') {
    const r = reports.find(x => x.id === a.report_id);
    if (r) {
      r.is_deleted = true;
      const u = users.find(x => x.id === r.user_id);
      if (u) u.is_suspended = true;
    }
    a.status = 'resolved';
    a.action_taken = 'Auteur suspendu et signalement masqué';
    logAction(req, 'Utilisateur suspendu pour abus', 'user', r ? r.user_id : 0, `Motif : ${a.reason}`);
  } else if (action === 'dismiss') {
    a.status = 'dismissed';
    a.action_taken = 'Classé sans suite';
    logAction(req, 'Abus classé sans suite', 'abuse', a.id, 'Pas d\'infraction constatée');
  } else {
    return res.status(400).json({ detail: 'Action invalide' });
  }

  res.json({ ok: true, status: a.status });
});

app.post('/api/admin/users/:id/toggle-suspend', requireAdmin, (req, res) => {
  const uid = parseInt(req.params.id, 10);
  const u = users.find(x => x.id === uid);
  if (!u) return res.status(404).json({ detail: 'Utilisateur introuvable' });
  if (u.id === req.user.id) return res.status(400).json({ detail: 'Impossible de modifier votre propre statut' });

  u.is_suspended = !u.is_suspended;
  logAction(req, u.is_suspended ? 'Utilisateur suspendu' : 'Utilisateur rétabli', 'user', u.id, u.name);
  res.json({ ok: true, is_suspended: u.is_suspended });
});

// ================= BOT TELEGRAM INTELLIGENT (MONOLITHE / WEBHOOK / FUZZY MATCHING / INLINE KEYBOARD) =================
const telegramPendingBatches = new Map();

const BUJUMBURA_STATION_ALIASES = {
  brarudi: 'brasserie',
  brasserie: 'brasserie',
  regideso: 'vip',
  musee: 'musee vivant',
  marche: 'marche central',
  kingstar: 'king star',
  inter: 'interpetrol',
  interpetrole: 'interpetrol',
  kigobe: 'kigobe city oil',
  gare: 'gare du sud',
  quick: 'quick service',
  safali: 'safari',
  yakeime: 'yakeime oil kinindo',
  gasoil: 'mazout',
  gazoil: 'mazout',
  diesel: 'mazout'
};

const STATION_STOP_WORDS = new Set([
  'station', 'service', 'bujumbura', 'burundi', 'chez', 'de', 'du', 'la', 'le', 'les', 'au', 'aux', 'pres', 'vers', 'quartier', 'commune'
]);

export function normalizeStationText(raw) {
  if (!raw) return '';
  const clean = String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = [];
  for (const tok of clean.split(/\s+/).filter(Boolean)) {
    if (STATION_STOP_WORDS.has(tok)) continue;
    const mapped = BUJUMBURA_STATION_ALIASES[tok] || tok;
    tokens.push(...mapped.split(/\s+/));
  }
  return tokens.join(' ');
}

function diceBigramsSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }
  return (2.0 * intersection) / (a.length - 1 + (b.length - 1));
}

const BRAND_TOKENS_SET = new Set([
  'kobil', 'interpetrol', 'mogas', 'engen', 'total', 'totalenergies', 'delta',
  'city', 'oil', 'vip', 'king', 'star', 'kimoil', 'safari', 'mega', 'yakeime',
  'geprotis', 'lybajas', 'petro', 'noe', 'rubis', 'oryx', 'shell', 'hass', 'tanganyika'
]);

const BUJUMBURA_ZONES_MAP = {
  rohero: { zone: 'Rohero', commune: 'Mukaza' },
  'centre ville': { zone: 'Centre-Ville', commune: 'Mukaza' },
  centre: { zone: 'Centre-Ville', commune: 'Mukaza' },
  buyenzi: { zone: 'Buyenzi', commune: 'Mukaza' },
  bwiza: { zone: 'Bwiza', commune: 'Mukaza' },
  nyakabiga: { zone: 'Nyakabiga', commune: 'Mukaza' },
  asiatique: { zone: 'Quartier Asiatique', commune: 'Mukaza' },
  industrielle: { zone: 'Zone Industrielle', commune: 'Mukaza' },
  brasserie: { zone: 'Zone Industrielle', commune: 'Mukaza' },
  jabe: { zone: 'Jabe', commune: 'Mukaza' },
  mpimba: { zone: 'Mpimba', commune: 'Mukaza' },
  'mutanga sud': { zone: 'Mutanga Sud', commune: 'Mukaza' },
  mutanga: { zone: 'Mutanga', commune: 'Mukaza' },
  kinindo: { zone: 'Kinindo', commune: 'Muha' },
  kibenga: { zone: 'Kibenga', commune: 'Muha' },
  kanyosha: { zone: 'Kanyosha', commune: 'Muha' },
  musaga: { zone: 'Musaga', commune: 'Muha' },
  kinanira: { zone: 'Kinanira', commune: 'Muha' },
  ruziba: { zone: 'Ruziba', commune: 'Muha' },
  kizingwe: { zone: 'Kizingwe', commune: 'Muha' },
  gisyo: { zone: 'Gisyo', commune: 'Muha' },
  gihosha: { zone: 'Gihosha', commune: 'Ntahangwa' },
  kamenge: { zone: 'Kamenge', commune: 'Ntahangwa' },
  ngagara: { zone: 'Ngagara', commune: 'Ntahangwa' },
  cibitoke: { zone: 'Cibitoke', commune: 'Ntahangwa' },
  kinama: { zone: 'Kinama', commune: 'Ntahangwa' },
  buterere: { zone: 'Buterere', commune: 'Ntahangwa' },
  carama: { zone: 'Carama', commune: 'Ntahangwa' },
  kigobe: { zone: 'Kigobe', commune: 'Ntahangwa' },
  kajaga: { zone: 'Kajaga', commune: 'Ntahangwa' },
  mirango: { zone: 'Mirango', commune: 'Ntahangwa' },
  maramvya: { zone: 'Maramvya', commune: 'Ntahangwa' },
  sororezo: { zone: 'Sororezo', commune: 'Mukaza' }
};

export function inferNewStationMetadata(item = {}) {
  const rawName = String(item.station_name || '').trim();
  const rawBrand = String(item.brand || '').trim();
  const rawZone = String(item.zone || '').trim();
  const rawCommune = String(item.commune || '').trim();
  const rawLoc = String(item.location_text || '').trim();
  const details = String(item.details || '').trim();

  const cleanName = rawName
    .replace(/^[\s\-•*0-9.)]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const formattedName = cleanName
    ? cleanName
        .split(' ')
        .map(w => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ')
    : 'Nouvelle Station';

  let detectedBrand = rawBrand || null;
  if (!detectedBrand) {
    const lowName = formattedName.toLowerCase();
    const brandMap = [
      [/inter\s*petrol|inter\b/i, 'InterPetrol'],
      [/\bkobil\b/i, 'Kobil'],
      [/\bmogas\b/i, 'Mogas'],
      [/\bengen\b/i, 'Engen'],
      [/\btotal/i, 'TotalEnergies'],
      [/\bdelta\b/i, 'Delta'],
      [/city\s*oil/i, 'City Oil'],
      [/\bvip\b/i, 'VIP'],
      [/king\s*star/i, 'King Star'],
      [/\bkimoil\b/i, 'Kimoil'],
      [/\bsafari\b/i, 'Safari'],
      [/mega\s*oil/i, 'Mega Oil'],
      [/\byakeime\b/i, 'Yakeime'],
      [/\brubis\b/i, 'Rubis'],
      [/\boryx\b/i, 'Oryx'],
      [/\bshell\b/i, 'Shell'],
      [/\bhass\b/i, 'Hass'],
      [/tanganyika/i, 'Tanganyika Oil']
    ];
    for (const [regex, bName] of brandMap) {
      if (regex.test(lowName)) {
        detectedBrand = bName;
        break;
      }
    }
  }

  let detectedZone = rawZone || '';
  let detectedCommune = ['Mukaza', 'Ntahangwa', 'Muha'].includes(rawCommune) ? rawCommune : '';

  const searchCorpus = `${rawZone} ${formattedName} ${rawLoc} ${details}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  for (const [key, info] of Object.entries(BUJUMBURA_ZONES_MAP)) {
    const reg = new RegExp(`\\b${key}\\b`, 'i');
    if (reg.test(searchCorpus)) {
      if (!detectedZone) detectedZone = info.zone;
      if (!detectedCommune) detectedCommune = info.commune;
      break;
    }
  }

  if (!detectedZone) {
    const nonBrandWords = formattedName
      .split(/\s+/)
      .filter(w => !BRAND_TOKENS_SET.has(w.toLowerCase()) && !/^(station|service|essence|mazout)$/i.test(w));
    detectedZone = nonBrandWords.length > 0 ? nonBrandWords[nonBrandWords.length - 1] : 'Bujumbura';
  }
  if (!detectedCommune) {
    const zLow = detectedZone.toLowerCase();
    if (BUJUMBURA_ZONES_MAP[zLow]) {
      detectedCommune = BUJUMBURA_ZONES_MAP[zLow].commune;
    } else {
      detectedCommune = 'Mukaza';
    }
  }

  const locationText = rawLoc || `Quartier ${detectedZone}, Commune ${detectedCommune}, Bujumbura`;

  return {
    name: formattedName,
    brand: detectedBrand,
    zone: detectedZone,
    commune: detectedCommune,
    location_text: locationText,
    landmark: details ? details.slice(0, 120) : null,
    fuels: 'Essence,Diesel'
  };
}

export function matchStationFuzzy(extractedName, stationList = stations, threshold = 0.52) {
  const queryNorm = normalizeStationText(extractedName);
  if (!queryNorm) return { station: null, score: 0 };

  const queryTokensArr = queryNorm.split(' ').filter(Boolean);
  const queryTokens = new Set(queryTokensArr);
  const brandQueryTokens = queryTokensArr.filter(t => BRAND_TOKENS_SET.has(t));
  const specificQueryTokens = queryTokensArr.filter(t => !BRAND_TOKENS_SET.has(t));

  let bestStation = null;
  let bestScore = 0;

  for (const st of stationList) {
    if (!st.is_active) continue;
    const nameNorm = normalizeStationText(st.name || '');
    const brandNorm = normalizeStationText(st.brand || '');
    const zoneNorm = normalizeStationText(st.zone || '');
    const landmarkNorm = normalizeStationText(`${st.landmark || ''} ${st.location_text || ''}`);

    if (queryNorm === nameNorm) {
      return { station: st, score: 1.0 };
    }

    const candMainTokens = new Set(`${nameNorm} ${zoneNorm}`.split(' ').filter(Boolean));
    const candAllTokensArr = `${nameNorm} ${brandNorm} ${zoneNorm} ${landmarkNorm}`.split(' ').filter(Boolean);
    const candAllTokens = new Set(candAllTokensArr);

    let overlapMainCount = 0;
    let overlapAllCount = 0;
    for (const qt of queryTokens) {
      if (candMainTokens.has(qt)) overlapMainCount++;
      if (candAllTokens.has(qt)) overlapAllCount++;
    }

    const overlapMain = overlapMainCount / Math.max(queryTokens.size, 1);
    const overlapAll = overlapAllCount / Math.max(queryTokens.size, 1);
    const seqName = diceBigramsSimilarity(queryNorm, nameNorm);
    const seqZone = diceBigramsSimilarity(queryNorm, `${brandNorm} ${zoneNorm}`.trim());

    let score = Math.max(
      seqName,
      seqZone,
      overlapMain * 0.75 + seqName * 0.25,
      overlapAll * 0.70 + Math.max(seqName, seqZone) * 0.30
    );

    if (brandNorm && queryTokens.has(brandNorm)) {
      const zoneMatched = zoneNorm && zoneNorm.split(' ').some(z => z && queryTokens.has(z));
      const landmarkMatched = landmarkNorm && landmarkNorm.split(' ').some(l => l && queryTokens.has(l));
      if (zoneMatched || landmarkMatched) {
        score = Math.max(score, 0.92);
      }
    }

    // Règle 1 : Si la requête mentionne une marque (ex: "Tanganyika Ruziba"), elle ne doit pas
    // être confondue avec une station d'une autre marque dans le même quartier (ex: "Noe Ruziba")
    if (brandQueryTokens.length > 0) {
      const brandMatched = brandQueryTokens.some(bt => candAllTokens.has(bt));
      if (!brandMatched) {
        score = Math.min(score, 0.35);
      }
    }

    // Règle 2 : Si la requête précise un lieu/quartier/identifiant spécifique (ex: "Kobil Gihosha")
    // tous les tokens spécifiques doivent correspondre à la station candidate
    if (specificQueryTokens.length > 0) {
      let matchedSpecificCount = 0;
      for (const sqt of specificQueryTokens) {
        let tokenMatched = candAllTokens.has(sqt);
        if (!tokenMatched) {
          for (const ct of candAllTokensArr) {
            if (!BRAND_TOKENS_SET.has(ct) && diceBigramsSimilarity(sqt, ct) >= 0.75) {
              tokenMatched = true;
              break;
            }
          }
        }
        if (tokenMatched) matchedSpecificCount++;
      }
      if (matchedSpecificCount < specificQueryTokens.length) {
        score = Math.min(score, 0.35);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestStation = st;
    }
  }

  const rounded = Math.round(Math.min(bestScore, 1.0) * 100) / 100;
  if (rounded >= threshold && bestStation) {
    return { station: bestStation, score: rounded };
  }
  return { station: null, score: rounded };
}

function normalizeBotFuelType(raw) {
  const val = String(raw || '').toLowerCase();
  const hasEss = /essence|super|\bess\b|sans plomb|both|deux/.test(val);
  const hasMaz = /mazout|gasoil|gazoil|diesel|\bmaz\b|both|deux/.test(val);
  if (val === 'both' || (hasEss && hasMaz)) return 'both';
  if (hasEss) return 'essence';
  if (hasMaz) return 'mazout';
  return 'unspecified';
}

function normalizeBotStatus(raw) {
  const val = String(raw || '').toLowerCase().trim();
  if (['distribution', 'starting', 'no_fuel', 'unknown'].includes(val)) return val;
  if (/sec|epuise|rien|ferme|pas de|rupture|no_fuel|vide/.test(val)) return 'no_fuel';
  if (/commence|depotage|camion|citerne|bientot|attente/.test(val)) return 'starting';
  if (/dispo|distrib|sert|ouvert|oui|ok|present/.test(val)) return 'distribution';
  return 'distribution';
}

function inferBotQueueStatus(details) {
  const d = String(details || '').toLowerCase();
  if (/longue|tres longue|embouteillage|satur/.test(d)) return 'long';
  if (/moyenne|moderee/.test(d)) return 'medium';
  if (/courte|fluide|rapide|peu de monde/.test(d)) return 'short';
  if (/aucune file|pas de file|sans file/.test(d)) return 'none';
  return 'unknown';
}

function fallbackParseWhatsAppText(rawText) {
  if (!rawText) return [];
  const rawLines = String(rawText)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  let currentFuel = 'unspecified';
  const items = [];

  for (const rawLine of rawLines) {
    const hadBulletOrNumber = /^[\s\-•*0-9.)]+/.test(rawLine);
    const line = rawLine.replace(/^[\s\-•*0-9.)]+/, '').trim();
    if (!line || line.length < 3) continue;

    const low = line.toLowerCase();

    // Ignorer les titres génériques de fiches
    if (/^(fiche|liste|communiqu|republique|ministere|bujumbura le|date\b|nb\b|total\s*:)/i.test(low) && !/station|kobil|interpetrol|mogas|engen|delta/i.test(low)) {
      continue;
    }

    if (line.length < 35 && /essence|mazout|gasoil|diesel/.test(low) && (line.endsWith(':') || !/[-–—]/.test(line))) {
      currentFuel = normalizeBotFuelType(low);
      if (line.endsWith(':') || line.split(/\s+/).length <= 3) {
        continue;
      }
    }

    const headPart = line.split(/[:\-–—(|]/)[0].trim();
    if (!headPart || headPart.length < 2) continue;

    const matchHead = matchStationFuzzy(headPart, stations, 0.52);
    const matchFull = matchStationFuzzy(line, stations, 0.52);
    const bestMatch = matchHead.score >= matchFull.score ? matchHead : matchFull;

    const hasBrandKeyword = /kobil|interpetrol|inter\b|mogas|engen|total|delta|city oil|vip|king star|kimoil|safari|mega oil|yakeime|geprotis|lybajas|petro|noe|rubis|oryx|shell|hass|tanganyika|station/i.test(low);
    const hasZoneKeyword = Object.keys(BUJUMBURA_ZONES_MAP).some(z => new RegExp(`\\b${z}\\b`, 'i').test(low));
    const hasSeparatorWithFuel = /[:\-–—|]/.test(line) && /essence|mazout|gasoil|diesel|dispo|sec|carburant|file|depotage/i.test(low);

    if (bestMatch.station || hasBrandKeyword || hasZoneKeyword || hasSeparatorWithFuel || hadBulletOrNumber) {
      let fuel = normalizeBotFuelType(low);
      if (fuel === 'unspecified') {
        fuel = currentFuel !== 'unspecified' ? currentFuel : 'both';
      }
      const status = normalizeBotStatus(low);
      const inferred = inferNewStationMetadata({
        station_name: headPart || line,
        details: line
      });
      items.push({
        station_name: headPart || line,
        brand: inferred.brand,
        zone: inferred.zone,
        commune: inferred.commune,
        location_text: inferred.location_text,
        fuel_type: fuel,
        status,
        details: line
      });
    }
  }
  return items;
}

async function runRealOpticalOcr(cleanBase64) {
  if (!cleanBase64) return '';
  try {
    const imgBuffer = Buffer.from(cleanBase64, 'base64');
    const result = await Tesseract.recognize(imgBuffer, 'fra');
    return String(result?.data?.text || '').trim();
  } catch (err) {
    console.warn('[Telegram OCR] Erreur Tesseract :', err.message);
    return '';
  }
}

async function extractBotReportsMultimodal({ rawText = '', imageBase64 = '', mimeType = 'image/jpeg' }) {
  const ai = getGeminiClient();
  const cleanBase64 = String(imageBase64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '')
    .trim();

  const catalog = stations
    .filter(s => s.is_active)
    .map(s => `${s.name} (Quartier: ${s.zone}, Commune: ${s.commune})`)
    .join(' ; ');

  const systemInstruction =
    `Tu es le moteur de Vision IA et d'extraction d'Igitoro Live à Bujumbura (Burundi).\n` +
    `Ta mission :\n` +
    `1. Si une image est fournie, déchiffre RÉELLEMENT et intégralement tout le texte, toutes les lignes et toutes les stations écrites sur l'image et place cette transcription dans "transcribed_text".\n` +
    `2. Extrais TOUTES les stations-service mentionnées dans l'image ou le texte, MÊME SI elles ne figurent pas encore dans le catalogue officiel (car le système va créer automatiquement les nouvelles stations dans la base de données après confirmation de l'administrateur).\n` +
    `3. Pour chaque station détectée, renseigne :\n` +
    `   - station_name : nom complet de la station tel que lu (ex: "Kobil Gihosha", "InterPetrol Brasserie", "Station Tanganyika Ruziba")\n` +
    `   - brand : marque de la station si identifiable (ex: "Kobil", "InterPetrol", "Mogas", "Engen", "TotalEnergies", "Delta", "City Oil", "Rubis", etc., sinon "")\n` +
    `   - zone : quartier ou zone à Bujumbura (ex: "Gihosha", "Kinindo", "Rohero", "Ruziba", "Kajaga", "Kamenge", "Mutanga", "Ngagara", etc.)\n` +
    `   - commune : commune de Bujumbura ("Mukaza", "Ntahangwa" ou "Muha")\n` +
    `   - location_text : avenue, route ou adresse lue sur l'image (sinon "Quartier <zone>, Bujumbura")\n` +
    `   - fuel_type : 'essence', 'mazout', 'both' ou 'unspecified'\n` +
    `   - status : 'distribution', 'starting', 'no_fuel' ou 'unknown'\n` +
    `   - details : détails exacts lus sur la ligne (type de carburant, file d'attente, observations).\n` +
    `Catalogue actuel des stations déjà enregistrées (à titre de référence uniquement, n'ignore JAMAIS une station absente de cette liste) : ${catalog}.`;

  if (ai && (rawText || cleanBase64)) {
    const parts = [];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
          data: cleanBase64
        }
      });
    }
    if (rawText) {
      parts.push({
        text: cleanBase64
          ? `Déchiffre toute l'image ci-jointe ainsi que cette légende :\n${rawText}\nExtrais toutes les stations (existantes ET nouvelles).`
          : `Analyse ce message et extrais toutes les stations (existantes ET nouvelles) :\n${rawText}`
      });
    } else if (cleanBase64) {
      parts.push({
        text: 'Lis attentivement cette image. Transcris le texte lu dans transcribed_text et extrais toutes les stations-service visibles (qu\'elles soient déjà dans le catalogue ou qu\'il s\'agisse de nouvelles stations à créer).'
      });
    }

    for (const modelName of ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-3.1-flash-lite']) {
      try {
        const resp = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction,
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                transcribed_text: {
                  type: Type.STRING,
                  description: 'Texte exact déchiffré sur l\'image ou résumé fidèle de ce qui est lu.'
                },
                stations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      station_name: { type: Type.STRING },
                      brand: { type: Type.STRING },
                      zone: { type: Type.STRING },
                      commune: { type: Type.STRING },
                      location_text: { type: Type.STRING },
                      fuel_type: { type: Type.STRING },
                      status: { type: Type.STRING },
                      details: { type: Type.STRING }
                    },
                    required: ['station_name', 'fuel_type', 'status', 'details']
                  }
                }
              },
              required: ['transcribed_text', 'stations']
            }
          }
        });

        const parsed = JSON.parse((resp.text || '{}').trim());
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.stations) ? parsed.stations : [];
        const transcribedText = typeof parsed.transcribed_text === 'string' ? parsed.transcribed_text.trim() : '';

        if (list.length > 0) {
          const items = list.map(x => {
            const inferred = inferNewStationMetadata(x);
            return {
              station_name: String(x.station_name || inferred.name).trim(),
              brand: String(x.brand || inferred.brand || '').trim() || null,
              zone: String(x.zone || inferred.zone || 'Bujumbura').trim(),
              commune: String(x.commune || inferred.commune || 'Mukaza').trim(),
              location_text: String(x.location_text || inferred.location_text).trim(),
              fuel_type: normalizeBotFuelType(x.fuel_type),
              status: normalizeBotStatus(x.status),
              details: String(x.details || '').trim()
            };
          });
          items._meta = {
            engine: cleanBase64 ? `Gemini Vision IA (${modelName})` : `Gemini IA (${modelName})`,
            deciphered_text: transcribedText || items.map(i => `${i.station_name} (${i.fuel_type})`).join(' | ')
          };
          return items;
        }
      } catch (err) {
        console.warn(`[Telegram Vision] Modèle ${modelName} indisponible :`, err.message);
      }
    }
  }

  // Si une image a été envoyée mais que Gemini Vision n'est pas configuré ou a échoué,
  // exécuter une lecture optique réelle des pixels (OCR Tesseract.js) !
  let ocrText = '';
  if (cleanBase64) {
    ocrText = await runRealOpticalOcr(cleanBase64);
  }

  const combinedText = [ocrText, rawText].filter(Boolean).join('\n');
  const fallbackItems = fallbackParseWhatsAppText(combinedText);
  fallbackItems._meta = {
    engine: cleanBase64
      ? ocrText
        ? 'OCR Optique Réel (Tesseract)'
        : 'Aucun moteur Vision actif (vérifiez GEMINI_API_KEY)'
      : 'Analyseur Heuristique Texte',
    deciphered_text: ocrText
  };
  return fallbackItems;
}

async function sendTelegramApi(method, payload) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return { ok: false, simulated: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function downloadTelegramPhotoBase64(fileId) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !fileId) return { base64: '', mimeType: 'image/jpeg' };
  try {
    const infoRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const infoData = await infoRes.json();
    const filePath = infoData?.result?.file_path;
    if (!filePath) return { base64: '', mimeType: 'image/jpeg' };

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!fileRes.ok) return { base64: '', mimeType: 'image/jpeg' };
    const arrayBuf = await fileRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString('base64');
    const mimeType = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { base64, mimeType };
  } catch (_) {
    return { base64: '', mimeType: 'image/jpeg' };
  }
}

function isAuthorizedTelegramChat(chatId, req) {
  const isLoopback =
    req &&
    (req.ip === '127.0.0.1' ||
      req.ip === '::1' ||
      req.ip === '::ffff:127.0.0.1' ||
      req.hostname === '127.0.0.1' ||
      req.hostname === 'localhost');
  if (isLoopback && (String(chatId) === 'admin-web' || String(chatId) === '999001')) {
    return true;
  }
  const rawAllowed = (process.env.TELEGRAM_ADMIN_CHAT_IDS || '').trim();
  if (!rawAllowed) return true;
  const numericIds = rawAllowed
    .split(',')
    .map(s => s.trim())
    .filter(s => /^-?\d+$/.test(s));
  if (numericIds.length === 0) return true;
  return numericIds.includes(String(chatId)) || String(chatId) === 'admin-web';
}

function getSanitizedTelegramSecret() {
  return (process.env.TELEGRAM_WEBHOOK_SECRET || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 256);
}

async function setupTelegramWebhookOnStartup() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return;
  const baseUrl = (
    process.env.PUBLIC_BASE_URL ||
    process.env.PUBLIC_SHARE_URL ||
    process.env.APP_URL ||
    'https://igitorolive.up.railway.app'
  ).replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/api/telegram/webhook`;
  const payload = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query']
  };
  const secret = getSanitizedTelegramSecret();
  if (secret) payload.secret_token = secret;

  const res = await sendTelegramApi('setWebhook', payload);
  if (res && res.ok) {
    console.log(`[Telegram Bot] Webhook enregistré sur ${webhookUrl}`);
  } else {
    console.warn(`[Telegram Bot] Échec d'enregistrement du webhook :`, res?.description || res?.error || 'inconnu');
  }
}

function buildTelegramStatsSummary() {
  const now = Date.now();
  const since24h = now - 24 * 3600 * 1000;
  const activeStations = stations.filter(s => s.is_active).length;
  const recent24h = reports.filter(r => !r.is_deleted && new Date(r.created_at).getTime() >= since24h);
  const bot24h = recent24h.filter(r => r.source === 'telegram_bot');
  const distSet = new Set(recent24h.filter(r => r.fuel_status === 'distribution').map(r => r.station_id));
  const noFuelSet = new Set(
    recent24h.filter(r => r.fuel_status === 'no_fuel' && !distSet.has(r.station_id)).map(r => r.station_id)
  );
  let pendingCount = 0;
  for (const b of telegramPendingBatches.values()) {
    if (b.status === 'pending') pendingCount++;
  }

  return (
    `📊 <b>BILAN IGITORO LIVE (24 DERNIÈRES HEURES)</b>\n\n` +
    `🏥 <b>État du système :</b> En ligne (Service OK)\n` +
    `⛽ <b>Stations actives :</b> ${activeStations} stations à Bujumbura\n` +
    `📝 <b>Signalements (24h) :</b> ${recent24h.length} (dont ${bot24h.length} via Bot Telegram)\n` +
    `🟢 <b>En distribution récente :</b> ${distSet.size} station(s)\n` +
    `🔴 <b>Signalées à sec :</b> ${noFuelSet.size} station(s)\n` +
    `⏳ <b>Lots en attente de validation :</b> ${pendingCount}`
  );
}

function escapeTelegramHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createPendingTelegramBatch({ chatId, sourceType, rawInput, extractedRaw }) {
  const enrichedItems = [];
  let matchedCount = 0;
  let newStationsCount = 0;

  const meta = (extractedRaw && extractedRaw._meta) || {};
  const engineLabel = meta.engine || (sourceType === 'image' ? 'Vision IA' : 'Analyse Texte');
  const decipheredText = String(meta.deciphered_text || '').trim();

  const fuelLabels = {
    essence: '⛽ Essence',
    mazout: '🛢️ Mazout',
    both: '⛽🛢️ Essence & Mazout',
    unspecified: '❓ Non précisé'
  };
  const stLabels = {
    distribution: '🟢 En distribution',
    starting: '🟡 Dépotage / Commence',
    no_fuel: '🔴 Pas de carburant',
    unknown: '⚪ Statut inconnu'
  };

  const lines = [
    '🤖 <b>PRÉ-VALIDATION IGITORO LIVE</b>',
    `📥 <b>Source :</b> <i>${sourceType === 'image' ? 'Photo / Fiche de distribution' : 'Message texte / WhatsApp'}</i>`,
    `🧠 <b>Moteur de lecture :</b> <code>${escapeTelegramHtml(engineLabel)}</code>`
  ];

  if (sourceType === 'image' && decipheredText) {
    const previewOcr = decipheredText.length > 350 ? decipheredText.slice(0, 350) + '…' : decipheredText;
    lines.push(`👁️ <b>Ce que j'ai lu sur l'image :</b>\n<pre>${escapeTelegramHtml(previewOcr)}</pre>`);
  }
  lines.push('');

  extractedRaw.forEach((item, idx) => {
    const rawName = String(item.station_name || '').trim();
    const fuelType = normalizeBotFuelType(item.fuel_type);
    const status = normalizeBotStatus(item.status);
    const details = String(item.details || '').trim();

    const { station: matchedSt, score } = matchStationFuzzy(rawName, stations);
    if (matchedSt) {
      matchedCount++;
      enrichedItems.push({
        station_id: matchedSt.id,
        will_create_station: false,
        station_name: rawName,
        matched_name: matchedSt.name,
        zone: matchedSt.zone,
        commune: matchedSt.commune,
        brand: matchedSt.brand,
        confidence: score,
        fuel_type: fuelType,
        status,
        details
      });
      lines.push(
        `${idx + 1}. ✅ <b>[Station existante] ${escapeTelegramHtml(matchedSt.name)}</b> (${escapeTelegramHtml(matchedSt.zone)}) — <i>${Math.round(score * 100)}%</i>\n` +
          `   • Action : Mettre à jour (${stLabels[status] || status} | ${fuelLabels[fuelType] || fuelType})` +
          (details ? `\n   • 📝 <i>${escapeTelegramHtml(details)}</i>` : '')
      );
    } else {
      newStationsCount++;
      const proposed = inferNewStationMetadata(item);
      enrichedItems.push({
        station_id: null,
        will_create_station: true,
        proposed_station: proposed,
        station_name: rawName,
        matched_name: proposed.name,
        zone: proposed.zone,
        commune: proposed.commune,
        brand: proposed.brand,
        location_text: proposed.location_text,
        confidence: score,
        fuel_type: fuelType,
        status,
        details
      });
      lines.push(
        `${idx + 1}. 🆕 <b>[Nouvelle station à créer] ${escapeTelegramHtml(proposed.name)}</b>\n` +
          `   • 📍 Quartier : <b>${escapeTelegramHtml(proposed.zone)}</b> (${escapeTelegramHtml(proposed.commune)}) | Marque : <b>${escapeTelegramHtml(proposed.brand || 'Indépendante')}</b>\n` +
          `   • ⚡ Action : <b>Créer dans la BDD</b> + publier (${stLabels[status] || status} | ${fuelLabels[fuelType] || fuelType})` +
          (details ? `\n   • 📝 <i>${escapeTelegramHtml(details)}</i>` : '')
      );
    }
  });

  lines.push('');
  lines.push(
    `📊 <b>Ce que je vais envoyer dans la base de données si vous confirmez :</b>\n` +
      `• 🔄 <b>${matchedCount}</b> station(s) existante(s) à mettre à jour\n` +
      `• 🆕 <b>${newStationsCount}</b> nouvelle(s) station(s) à créer automatiquement`
  );
  lines.push("🔒 <i>Aucune donnée n'est écrite en production tant que vous n'avez pas cliqué sur Confirmer.</i>");

  const batchId = crypto.randomBytes(8).toString('hex');
  const confirmBtnText =
    newStationsCount > 0
      ? `✅ Confirmer (${matchedCount} MàJ + ${newStationsCount} création${newStationsCount > 1 ? 's' : ''})`
      : '✅ Confirmer la mise à jour';

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: confirmBtnText, callback_data: `confirm_batch:${batchId}` },
        { text: '❌ Annuler', callback_data: `cancel_batch:${batchId}` }
      ]
    ]
  };

  const batch = {
    id: batchId,
    chat_id: String(chatId || 'admin'),
    source_type: sourceType,
    engine: engineLabel,
    deciphered_text: decipheredText,
    raw_input: String(rawInput || '').slice(0, 4000),
    extracted_items: enrichedItems,
    status: 'pending',
    summary_html: lines.join('\n'),
    reply_markup: replyMarkup,
    created_at: new Date().toISOString(),
    resolved_at: null
  };

  telegramPendingBatches.set(batchId, batch);
  return batch;
}

function executeBatchConfirmation(batchId) {
  const batch = telegramPendingBatches.get(batchId);
  if (!batch) {
    return { ok: false, inserted: 0, created_stations_count: 0, message: '⚠️ Lot introuvable ou expiré.' };
  }
  if (batch.status !== 'pending') {
    return { ok: false, inserted: 0, created_stations_count: 0, message: `ℹ️ Ce lot a déjà été traité (statut : ${batch.status}).` };
  }

  let adminUser = users.find(u => u.is_admin);
  if (!adminUser) {
    adminUser = {
      id: nextUserId++,
      google_sub: 'telegram-admin-bot',
      name: 'Admin Igitoro (Telegram Bot)',
      email: 'admin@igitorolive.bi',
      reputation_score: 5.0,
      badge: 'Ambassadeur Fiable',
      is_admin: true,
      is_suspended: false,
      created_at: new Date().toISOString()
    };
    users.push(adminUser);
  }

  let inserted = 0;
  let createdStationsCount = 0;
  const updatedNames = [];
  const createdStationNames = [];
  const nowIso = new Date().toISOString();

  for (const item of batch.extracted_items) {
    let targetStationId = item.station_id;

    // Si la station n'existait pas dans la BDD, on la crée maintenant après confirmation de l'admin !
    if (!targetStationId && item.will_create_station && item.proposed_station) {
      const prop = item.proposed_station;
      // Vérifier si elle vient d'être créée dans ce même lot
      const existingNow = matchStationFuzzy(prop.name, stations, 0.82);
      if (existingNow.station) {
        targetStationId = existingNow.station.id;
        item.station_id = targetStationId;
      } else {
        const newStation = {
          id: nextStationId++,
          name: prop.name,
          brand: prop.brand || null,
          commune: prop.commune || 'Mukaza',
          zone: prop.zone || 'Bujumbura',
          location_text: prop.location_text || `Quartier ${prop.zone || 'Bujumbura'}, Bujumbura`,
          landmark: prop.landmark || null,
          fuels: prop.fuels || 'Essence,Diesel',
          is_active: true,
          is_verified: true,
          verified_label: 'Créée via Bot Telegram Admin',
          created_at: nowIso
        };
        stations.push(newStation);
        targetStationId = newStation.id;
        item.station_id = newStation.id;
        createdStationsCount++;
        createdStationNames.push(`${newStation.name} (${newStation.zone})`);

        actionLogs.push({
          id: actionLogs.length + 1,
          admin_id: adminUser.id,
          admin_name: adminUser.name,
          action: 'Nouvelle station créée via Bot Telegram',
          target_type: 'station',
          target_id: newStation.id,
          details: `${newStation.name} — Quartier ${newStation.zone} (${newStation.commune})`,
          created_at: nowIso
        });
      }
    }

    if (!targetStationId) continue;

    reports.push({
      id: nextReportId++,
      station_id: targetStationId,
      user_id: adminUser.id,
      fuel_status: item.status || 'distribution',
      fuel_type: item.fuel_type || 'unspecified',
      queue_status: inferBotQueueStatus(item.details),
      queue_bucket: null,
      wait_bucket: null,
      comment: item.details || 'Mise à jour validée via Bot Telegram Admin',
      photo_path: null,
      source: 'telegram_bot',
      is_deleted: false,
      created_at: nowIso
    });
    inserted++;
    updatedNames.push(item.matched_name || `Station #${targetStationId}`);
  }

  batch.status = 'confirmed';
  batch.resolved_at = nowIso;

  actionLogs.push({
    id: actionLogs.length + 1,
    admin_id: adminUser.id,
    admin_name: adminUser.name,
    action: `Bot Telegram : Lot ${batchId} confirmé`,
    target_type: 'telegram_batch',
    target_id: batchId,
    details: `${createdStationsCount} nouvelle(s) station(s) créée(s), ${inserted} signalement(s) publié(s) : ${updatedNames.join(', ')}`,
    created_at: nowIso
  });

  const msgLines = [
    `✅ <b>Mise à jour publiée en production !</b>`,
    `• 📝 <b>${inserted}</b> signalement(s) enregistré(s) dans la base de données.`
  ];
  if (createdStationsCount > 0) {
    msgLines.push(`• 🆕 <b>${createdStationsCount} nouvelle(s) station(s) créée(s) :</b> ${escapeTelegramHtml(createdStationNames.join(', '))}`);
  }
  msgLines.push(`• ⛽ <b>Stations mises à jour :</b> ${updatedNames.length ? escapeTelegramHtml(updatedNames.join(', ')) : 'Aucune'}`);

  return {
    ok: true,
    inserted,
    created_stations_count: createdStationsCount,
    created_stations: createdStationNames,
    updated_stations: updatedNames,
    message: msgLines.join('\n')
  };
}

function executeBatchCancellation(batchId) {
  const batch = telegramPendingBatches.get(batchId);
  if (!batch) {
    return { ok: false, message: '⚠️ Lot introuvable.' };
  }
  if (batch.status !== 'pending') {
    return { ok: false, message: `ℹ️ Ce lot est déjà à l'état « ${batch.status} ».` };
  }
  batch.status = 'cancelled';
  batch.resolved_at = new Date().toISOString();
  return {
    ok: true,
    message: "❌ <b>Opération annulée.</b> Aucun signalement n'a été écrit dans la base de données."
  };
}

// Gestionnaire de petits messages d'attente éphémères sur Telegram (affichés pendant l'action puis supprimés dès la fin)
function createTelegramTransientStatus(chatId) {
  let statusMessageId = null;
  const steps = [];
  let deleted = false;

  return {
    steps,
    get isDeleted() {
      return deleted;
    },
    async update(actionLabel) {
      const htmlText = `⏳ <b>Exécution :</b> <i>${escapeTelegramHtml(actionLabel)}</i>`;
      steps.push(actionLabel);

      await sendTelegramApi('sendChatAction', {
        chat_id: chatId,
        action: 'typing'
      });

      if (!statusMessageId) {
        const res = await sendTelegramApi('sendMessage', {
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML'
        });
        if (res && res.ok && res.result && res.result.message_id) {
          statusMessageId = res.result.message_id;
        } else {
          statusMessageId = `sim-${Date.now()}`;
        }
      } else if (!String(statusMessageId).startsWith('sim-')) {
        await sendTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: statusMessageId,
          text: htmlText,
          parse_mode: 'HTML'
        });
      }
    },
    async clear() {
      if (statusMessageId && !String(statusMessageId).startsWith('sim-')) {
        await sendTelegramApi('deleteMessage', {
          chat_id: chatId,
          message_id: statusMessageId
        });
      }
      statusMessageId = null;
      deleted = true;
    }
  };
}

// Webhook officiel Telegram (POST /api/telegram/webhook)
app.post('/api/telegram/webhook', async (req, res) => {
  const isLoopback =
    req.ip === '127.0.0.1' ||
    req.ip === '::1' ||
    req.ip === '::ffff:127.0.0.1' ||
    req.hostname === '127.0.0.1' ||
    req.hostname === 'localhost';
  const expectedSecret = getSanitizedTelegramSecret();
  const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (expectedSecret && headerSecret !== expectedSecret && !isLoopback && !req.session?.user_id) {
    return res.status(403).json({ detail: 'Secret de webhook Telegram invalide' });
  }

  const update = req.body || {};

  // 1. Gestion des boutons Inline Keyboard (callback_query)
  if (update.callback_query) {
    const cb = update.callback_query;
    const cbId = cb.id;
    const data = String(cb.data || '');
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;

    if (data.startsWith('confirm_batch:')) {
      const batchId = data.split(':')[1];
      const progress = createTelegramTransientStatus(chatId || 'admin');
      await progress.update('Création des nouvelles stations et enregistrement des signalements dans la base de données…');

      const result = executeBatchConfirmation(batchId);
      await progress.clear();

      if (cbId) {
        await sendTelegramApi('answerCallbackQuery', {
          callback_query_id: cbId,
          text: result.ok
            ? `✅ ${result.inserted} signalement(s) et ${result.created_stations_count || 0} nouvelle(s) station(s) !`
            : result.message
        });
      }
      if (chatId && messageId) {
        await sendTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: result.message,
          parse_mode: 'HTML'
        });
      }
      return res.json({
        ok: result.ok,
        action: 'confirmed',
        batch_id: batchId,
        inserted: result.inserted,
        created_stations_count: result.created_stations_count || 0,
        created_stations: result.created_stations || [],
        updated_stations: result.updated_stations || [],
        execution_steps: progress.steps,
        transient_message_deleted: progress.isDeleted,
        message: result.message
      });
    }

    if (data.startsWith('cancel_batch:')) {
      const batchId = data.split(':')[1];
      const progress = createTelegramTransientStatus(chatId || 'admin');
      await progress.update('Annulation du lot en cours…');

      const result = executeBatchCancellation(batchId);
      await progress.clear();

      if (cbId) {
        await sendTelegramApi('answerCallbackQuery', {
          callback_query_id: cbId,
          text: '❌ Mise à jour annulée.'
        });
      }
      if (chatId && messageId) {
        await sendTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: result.message,
          parse_mode: 'HTML'
        });
      }
      return res.json({
        ok: result.ok,
        action: 'cancelled',
        batch_id: batchId,
        execution_steps: progress.steps,
        transient_message_deleted: progress.isDeleted,
        message: result.message
      });
    }

    return res.json({ ok: true, action: 'ignored_callback' });
  }

  // 2. Gestion des messages entrants (Texte, Forward WhatsApp, Photo, Commandes)
  const message = update.message || update.edited_message;
  if (!message) {
    return res.json({ ok: true, action: 'no_message' });
  }

  const chatId = message.chat?.id || 'admin';
  if (!isAuthorizedTelegramChat(chatId, req)) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: '⛔ Ce bot est réservé à l\'administration d\'Igitoro Live.'
    });
    return res.status(403).json({ ok: false, reason: 'unauthorized_chat' });
  }

  const text = String(message.text || message.caption || '').trim();
  let imageBase64 = String(message.image_base64 || '').trim();
  let mimeType = message.mime_type || 'image/jpeg';
  const hasTelegramPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const hasTelegramDocImage = Boolean(message.document && String(message.document.mime_type || '').startsWith('image/'));
  const isImageInput = Boolean(imageBase64 || hasTelegramPhoto || hasTelegramDocImage);

  const progress = createTelegramTransientStatus(chatId);

  try {
    if (text.startsWith('/stats') || text.startsWith('/bilan') || text.startsWith('/health')) {
      await progress.update('Calcul du bilan des 24 dernières heures et vérification de la base de données…');
      const summary = buildTelegramStatsSummary();
      await progress.clear();

      await sendTelegramApi('sendMessage', {
        chat_id: chatId,
        text: summary,
        parse_mode: 'HTML'
      });
      return res.json({
        ok: true,
        action: 'stats',
        execution_steps: progress.steps,
        transient_message_deleted: progress.isDeleted,
        message: summary
      });
    }

    if (text.startsWith('/start') || text.startsWith('/help')) {
      await progress.update('Chargement du guide du Bot Admin Igitoro Live…');
      const helpMsg =
        '👋 <b>Bienvenue sur le Bot Admin d\'Igitoro Live !</b>\n\n' +
        '• Transférez un message WhatsApp ou envoyez une photo de fiche de distribution.\n' +
        '• Vérifiez le résumé JSON + Fuzzy Matching et cliquez sur <b>✅ Confirmer la mise à jour</b> ou <b>❌ Annuler</b>.\n' +
        '• Tapez <code>/stats</code> pour obtenir le bilan des 24 dernières heures.';
      await progress.clear();

      await sendTelegramApi('sendMessage', {
        chat_id: chatId,
        text: helpMsg,
        parse_mode: 'HTML'
      });
      return res.json({
        ok: true,
        action: 'help',
        execution_steps: progress.steps,
        transient_message_deleted: progress.isDeleted,
        message: helpMsg
      });
    }

    if (!imageBase64 && hasTelegramPhoto) {
      await progress.update('Téléchargement de la photo depuis Telegram…');
      const largestPhoto = message.photo[message.photo.length - 1];
      const downloaded = await downloadTelegramPhotoBase64(largestPhoto.file_id);
      imageBase64 = downloaded.base64;
      mimeType = downloaded.mimeType;
    } else if (!imageBase64 && hasTelegramDocImage) {
      await progress.update('Téléchargement du fichier image depuis Telegram…');
      const downloaded = await downloadTelegramPhotoBase64(message.document.file_id);
      imageBase64 = downloaded.base64;
      mimeType = message.document.mime_type || downloaded.mimeType;
    }

    if (isImageInput) {
      await progress.update('Déchiffrage de l\'image par Vision IA / OCR et détection des stations…');
    } else {
      await progress.update('Analyse du message texte et extraction des stations…');
    }

    const extractedRaw = await extractBotReportsMultimodal({
      rawText: text,
      imageBase64,
      mimeType
    });

    if (!extractedRaw || extractedRaw.length === 0) {
      await progress.clear();
      const alertMsg =
        '⚠️ <b>Aucune station-service détectée.</b> Le message ou l\'image ne contient pas de station identifiable à Bujumbura.';
      await sendTelegramApi('sendMessage', {
        chat_id: chatId,
        text: alertMsg,
        parse_mode: 'HTML'
      });
      return res.json({
        ok: false,
        reason: 'no_stations_extracted',
        execution_steps: progress.steps,
        transient_message_deleted: progress.isDeleted,
        message: alertMsg
      });
    }

    await progress.update('Comparaison avec la base de données (stations existantes et nouvelles stations à créer)…');

    const batch = createPendingTelegramBatch({
      chatId,
      sourceType: isImageInput ? 'image' : 'text',
      rawInput: text || '[Image fiche de distribution]',
      extractedRaw
    });

    // Supprimer le petit message d'attente dès que l'analyse est terminée !
    await progress.clear();

    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: batch.summary_html,
      parse_mode: 'HTML',
      reply_markup: batch.reply_markup
    });

    return res.json({
      ok: true,
      action: 'pending_validation',
      batch_id: batch.id,
      engine: batch.engine,
      deciphered_text: batch.deciphered_text,
      extracted_items: batch.extracted_items,
      execution_steps: progress.steps,
      transient_message_deleted: progress.isDeleted,
      summary: batch.summary_html,
      reply_markup: batch.reply_markup
    });
  } catch (err) {
    await progress.clear();
    throw err;
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ detail: err.message || 'Erreur serveur' });
});

// Start Server
if (process.env.SKIP_SERVER_LISTEN !== 'true') {
  app.listen(PORT, HOST, () => {
    console.log(`Igitoro Live server running on http://${HOST}:${PORT}`);
    setupTelegramWebhookOnStartup().catch(() => {});
  });
}

export { app };
