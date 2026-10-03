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
let nextStationId = 13;
let nextReportId = 3;
let nextConfirmationId = 3;
let nextAbuseId = 1;
let nextSubId = 1;

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
  { id: 1, name: 'Cobil Mutanga', brand: 'Cobil', zone: 'Mutanga', location_text: 'Mutanga, Bujumbura', landmark: 'quartier Mutanga', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 2, name: 'Cobil Kigobe', brand: 'Cobil', zone: 'Kigobe', location_text: 'Kigobe, Bujumbura', landmark: 'quartier Kigobe', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 3, name: 'Cobil Kamenge', brand: 'Cobil', zone: 'Kamenge', location_text: 'Kamenge, Bujumbura', landmark: 'quartier Kamenge', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 4, name: 'Kobil Buyenzi', brand: 'Kobil', zone: 'Buyenzi', location_text: 'Buyenzi, Bujumbura', landmark: 'quartier Buyenzi', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 5, name: 'Kobil Rohero', brand: 'Kobil', zone: 'Rohero', location_text: 'Rohero, Bujumbura', landmark: 'quartier Rohero', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 6, name: 'Engen Kinindo', brand: 'Engen', zone: 'Kinindo', location_text: 'Kinindo, Bujumbura', landmark: 'quartier Kinindo', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 7, name: 'Engen Gihosha', brand: 'Engen', zone: 'Gihosha', location_text: 'Gihosha, Bujumbura', landmark: 'quartier Gihosha', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 8, name: 'Station Mutanga', brand: null, zone: 'Mutanga', location_text: 'Mutanga, Bujumbura', landmark: 'quartier Mutanga', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 9, name: 'Station Rohero', brand: null, zone: 'Rohero', location_text: 'Rohero, Bujumbura', landmark: 'quartier Rohero', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 10, name: 'Station Kinindo', brand: null, zone: 'Kinindo', location_text: 'Kinindo, Bujumbura', landmark: 'quartier Kinindo', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 11, name: 'Station Buyenzi', brand: null, zone: 'Buyenzi', location_text: 'Buyenzi, Bujumbura', landmark: 'quartier Buyenzi', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() },
  { id: 12, name: 'Station Gihosha', brand: null, zone: 'Gihosha', location_text: 'Gihosha, Bujumbura', landmark: 'quartier Gihosha', fuels: 'Essence,Diesel', is_active: true, created_at: new Date().toISOString() }
];
const stations = [...initialStations];

const reports = [
  {
    id: 1,
    station_id: 1,
    user_id: 1,
    fuel_status: 'distribution',
    queue_status: 'short',
    approximate_count: '15 véhicules',
    station_open: 'yes',
    comment: 'Pompes en service pour essence et mazout. Service fluide.',
    photo_path: null,
    created_at: new Date(Date.now() - 15 * 60000).toISOString(),
    is_deleted: false
  },
  {
    id: 2,
    station_id: 6,
    user_id: 1,
    fuel_status: 'no_fuel',
    queue_status: 'none',
    approximate_count: '0',
    station_open: 'no',
    comment: 'Pas de carburant ce matin.',
    photo_path: null,
    created_at: new Date(Date.now() - 35 * 60000).toISOString(),
    is_deleted: false
  }
];

const confirmations = [
  { id: 1, report_id: 1, user_id: 1, kind: 'confirm', created_at: new Date().toISOString() }
];

const abuseReports = [];
const zoneSubscriptions = [];
const actionLogs = [];

const statusLabels = {
  distribution: 'On distribue',
  no_fuel: 'Pas de carburant',
  starting: 'Ça semble commencer',
  unknown: 'Pas d’information récente'
};

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
    statusLabels
  });
});

app.get('/stations/:id', (req, res) => {
  const stationId = parseInt(req.params.id, 10);
  const s = stations.find(x => x.id === stationId && x.is_active);
  const stationReports = reports
    .filter(r => r.station_id === stationId && !r.is_deleted)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20);

  res.render('station', {
    ...ctx(req),
    station: s || null,
    state: s ? aggregate(s) : null,
    reports: stationReports,
    statusLabels
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

  const zones = ['Buyenzi', 'Kinindo', 'Mutanga', 'Rohero', 'Kamenge', 'Gihosha', 'Muyaga'];
  const recentReports = reports
    .filter(r => !r.is_deleted)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map(r => ({
      ...r,
      station: stations.find(s => s.id === r.station_id),
      created_at_formatted: freshness(r.created_at)
    }));

  res.render('notifications', {
    ...ctx(req),
    zones,
    subscribed: subs,
    recent: recentReports
  });
});

app.get('/profil', (req, res) => {
  const user = getCurrentUser(req);
  const userReports = user
    ? reports
        .filter(r => r.user_id === user.id && !r.is_deleted)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 20)
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
        (s.brand && s.brand.toLowerCase().includes(q))
    );
  }
  const result = list.slice(0, 30).map(s => ({
    id: s.id,
    name: s.name,
    brand: s.brand,
    zone: s.zone,
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
    location: s.location_text,
    landmark: s.landmark,
    state: aggregate(s)
  });
});

app.post('/api/stations', (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.zone || !payload.location_text) {
    return res.status(400).json({ detail: 'Champs obligatoires manquants' });
  }
  const station = {
    id: nextStationId++,
    name: payload.name.trim(),
    brand: payload.brand ? payload.brand.trim() : null,
    zone: payload.zone.trim(),
    location_text: payload.location_text.trim(),
    landmark: payload.landmark ? payload.landmark.trim() : null,
    fuels: payload.fuels || 'Essence,Diesel',
    is_active: true,
    created_at: new Date().toISOString()
  };
  stations.push(station);
  res.json({ ok: true, station_id: station.id });
});

// ================= API: Reports =================
app.post('/api/reports', upload.single('photo'), (req, res) => {
  let user = getCurrentUser(req);
  if (!user) {
    // If user has not signed in yet, assign/create a guest session user
    user = {
      id: nextUserId++,
      google_sub: 'guest-' + Date.now(),
      name: 'Utilisateur anonyme',
      email: null,
      is_admin: false,
      is_suspended: false,
      created_at: new Date().toISOString()
    };
    users.push(user);
    req.session.user_id = user.id;
  }

  if (!limiter.allow(`r:${user.id}`)) {
    return res.status(429).json({ detail: 'Trop de signalements récemment' });
  }

  const stationId = parseInt(req.body.station_id, 10);
  const station = stations.find(s => s.id === stationId);
  if (!station) {
    return res.status(404).json({ detail: 'Station introuvable' });
  }

  const fuel_status = req.body.fuel_status;
  const queue_status = req.body.queue_status;
  const approximate_count = req.body.approximate_count || 'unknown';
  const station_open = req.body.station_open || 'unknown';
  const comment = (req.body.comment || '').trim() || null;
  const photo_path = req.file ? `/static/uploads/${req.file.filename}` : null;

  const report = {
    id: nextReportId++,
    station_id: stationId,
    user_id: user.id,
    fuel_status,
    queue_status,
    approximate_count,
    station_open,
    comment,
    photo_path,
    created_at: new Date().toISOString(),
    is_deleted: false
  };
  reports.push(report);

  res.json({ ok: true, report_id: report.id });
});

app.post('/api/reports/:id/verify', requireAuth, (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  const r = reports.find(x => x.id === reportId);
  if (!r) return res.status(404).json({ detail: 'Signalement introuvable' });

  const kind = req.body.kind;
  if (kind !== 'confirm' && kind !== 'no_longer_true') {
    return res.status(400).json({ detail: 'Type invalide' });
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
  if (!r || r.user_id !== req.user.id) {
    return res.status(404).json({ detail: 'Signalement introuvable' });
  }
  r.is_deleted = true;
  res.json({ ok: true });
});

app.post('/api/reports/:id/abuse', requireAuth, (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  const r = reports.find(x => x.id === reportId);
  if (!r) return res.status(404).json({ detail: 'Signalement introuvable' });

  if (!limiter.allow(`a:${req.user.id}`, 1)) {
    return res.status(429).json({ detail: 'Trop de signalements de modération' });
  }

  abuseReports.push({
    id: nextAbuseId++,
    report_id: reportId,
    user_id: req.user.id,
    reason: req.body.reason || 'Autre',
    details: req.body.details || null,
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
  res.json({ ok: true, user: { id: user.id, name: user.name } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.delete('/api/auth/account', requireAuth, (req, res) => {
  req.user.name = 'Compte supprimé';
  req.user.email = null;
  req.user.google_sub = `deleted-${req.user.id}-${req.user.google_sub}`;
  req.user.is_suspended = true;
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
  const zone = req.body.zone;
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
  const zone = req.body.zone;
  const idx = zoneSubscriptions.findIndex(z => z.user_id === req.user.id && z.zone === zone);
  if (idx !== -1) {
    zoneSubscriptions.splice(idx, 1);
  }
  res.json({ ok: true, subscribed: false, zone });
});

// ================= API: Admin =================
function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user || !user.is_admin) {
    return res.status(403).json({ detail: 'Accès administrateur requis' });
  }
  req.user = user;
  next();
}

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  res.json({
    users: users.length,
    stations: stations.length,
    reports: reports.length,
    pending_abuse: abuseReports.filter(a => a.status === 'pending').length
  });
});

app.post('/api/admin/stations/:id/toggle', requireAdmin, (req, res) => {
  const s = stations.find(x => x.id === parseInt(req.params.id, 10));
  if (!s) return res.status(404).json({ detail: 'Station introuvable' });
  s.is_active = !s.is_active;
  res.json({ ok: true, active: s.is_active });
});

app.post('/api/admin/abuse/:id/moderate', requireAdmin, (req, res) => {
  const a = abuseReports.find(x => x.id === parseInt(req.params.id, 10));
  if (!a) return res.status(404).json({ detail: 'Abus introuvable' });
  const action = req.body.action;
  if (action === 'hide_report') {
    const r = reports.find(x => x.id === a.report_id);
    if (r) r.is_deleted = true;
  }
  if (action === 'suspend_user') {
    const u = users.find(x => x.id === a.user_id);
    if (u) u.is_suspended = true;
  }
  a.status = 'resolved';
  res.json({ ok: true });
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
