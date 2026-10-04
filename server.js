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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ detail: err.message || 'Erreur serveur' });
});

// Start Server
if (process.env.SKIP_SERVER_LISTEN !== 'true') {
  app.listen(PORT, HOST, () => {
    console.log(`Igitoro Live server running on http://${HOST}:${PORT}`);
  });
}

export { app };
