import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

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
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SECRET_KEY || 'igitoro-secret-key-live',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
  })
);

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

// In-Memory Database
let nextUserId = 2;
let nextStationId = 29; // Fixed: initial stations have IDs 1 through 28
let nextReportId = 3;
let nextConfirmationId = 3;
let nextAbuseId = 1;
let nextSubId = 1;
let nextClaimId = 1;

const users = [
  {
    id: 1,
    google_sub: 'demo',
    name: 'Tedd Greg',
    email: 'tedd@example.bi',
    is_admin: true,
    is_suspended: false,
    created_at: new Date().toISOString()
  }
];

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
    return res.status(401).json({ detail: 'Connexion requise. Veuillez vous connecter dans l’onglet Profil.' });
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

function ctx(req) {
  return {
    user: getCurrentUser(req)
  };
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

app.post('/api/stations', (req, res) => {
  let user = getCurrentUser(req);
  const userKey = user ? user.id : (req.ip || 'guest');
  if (!limiter.allow(`st_add:${userKey}`, 1)) {
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
app.post('/api/reports', upload.single('photo'), (req, res) => {
  let user = getCurrentUser(req);
  if (!user) {
    user = {
      id: nextUserId++,
      google_sub: 'guest-' + Date.now(),
      name: 'Utilisateur invité',
      email: null,
      is_admin: false,
      is_suspended: false,
      created_at: new Date().toISOString()
    };
    users.push(user);
    req.session.user_id = user.id;
  }

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

// ================= API: Auth =================
app.post('/api/auth/google', (req, res) => {
  const payload = req.body || {};
  const cred = payload.credential || '';
  let sub = '', name = 'Utilisateur', email = null;

  if (cred.startsWith('mock:')) {
    const parts = cred.split(':');
    sub = parts[1] || 'mock-user-1';
    name = parts[2] || 'Utilisateur';
  } else if (cred) {
    sub = 'user-' + Buffer.from(cred).toString('hex').slice(0, 16);
    name = 'Utilisateur Google';
  } else {
    return res.status(400).json({ detail: 'Jeton manquant' });
  }

  let user = users.find(u => u.google_sub === sub);
  if (!user) {
    user = {
      id: nextUserId++,
      google_sub: sub,
      name,
      email,
      is_admin: users.length === 0,
      is_suspended: false,
      created_at: new Date().toISOString()
    };
    users.push(user);
  } else {
    user.name = name;
    if (email) user.email = email;
  }

  req.session.user_id = user.id;
  res.json({ ok: true, user: { id: user.id, name: user.name, is_admin: user.is_admin } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
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
    name: payload.name.trim(),
    brand: payload.brand ? payload.brand.trim() : null,
    commune: payload.commune ? payload.commune.trim() : 'Mukaza',
    zone: payload.zone.trim(),
    location_text: payload.location_text.trim(),
    landmark: payload.landmark ? payload.landmark.trim() : null,
    fuels: payload.fuels ? payload.fuels.trim() : 'Essence,Diesel',
    is_active: true,
    is_verified: true,
    verified_label: 'Créée par l\'administration',
    created_at: new Date().toISOString()
  };

  stations.push(s);
  logAction(req, 'Station officielle ajoutée', 'station', s.id, `${s.name} (${s.zone})`);
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
app.listen(PORT, HOST, () => {
  console.log(`Igitoro Live server running on http://${HOST}:${PORT}`);
});
