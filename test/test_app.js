import assert from 'assert';
import crypto from 'crypto';

process.env.SKIP_SERVER_LISTEN = 'true';
const { verifyGoogleOidcToken } = await import('../server.js');

const BASE_URL = 'http://127.0.0.1:3000';
const SECRET_KEY = process.env.SECRET_KEY || 'igitoro-secret-key-live';

/**
 * Génère un JWT OIDC de test signé avec HMAC-SHA256 uniquement accepté en développement local
 * (et strictement rejeté lorsque NODE_ENV=production).
 */
function createSignedTestOidcJwt({
  sub = 'google-sub-10987654321',
  name = 'Jean Ndayishimiye',
  email = 'jean.ndayishimiye@example.bi',
  aud = process.env.GOOGLE_CLIENT_ID || 'igitoro-local-test-client',
  iss = 'https://accounts.google.com',
  expOffsetSec = 3600,
  secret = SECRET_KEY
} = {}) {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: 'local-dev-test-only'
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iss,
    sub,
    aud,
    iat: nowSec,
    exp: nowSec + expOffsetSec,
    email,
    email_verified: true,
    name
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

async function runTests() {
  console.log('--- Démarrage de la suite de tests automatisée Igitoro Live ---');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ [FAIL] ${name} :`, err.message);
      failed++;
    }
  }

  // ================= 1. Routes web principales =================
  await test('GET / répond avec HTTP 200 et contient le titre', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Igitoro'));
    assert(text.includes('Mukaza'));
  });

  await test('GET /stations/1 répond avec HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/stations/1`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Kimoil Fuel Stop'));
    assert(text.includes('Itinéraire') || text.includes('itinéraire'));
  });

  await test('GET /stations/999999 gère la station inexistante sans crash', async () => {
    const res = await fetch(`${BASE_URL}/stations/999999`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Station introuvable'));
  });

  await test('GET /signaler répond avec HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/signaler`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Nouveau signalement'));
  });

  await test('GET /notifications répond avec HTTP 200 et liste des quartiers', async () => {
    const res = await fetch(`${BASE_URL}/notifications`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Alertes'));
  });

  await test('GET /profil répond avec HTTP 200 et sans prompt de nom', async () => {
    const res = await fetch(`${BASE_URL}/profil`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Connexion Google (OAuth 2.0 / OpenID Connect)'));
    assert(!text.includes('googleMockLogin'));
  });

  await test('GET /health répond avec status ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
  });

  await test('Manifest PWA et icônes Pompe à essence (180x180, 192x192, 512x512, SVG) sont servis avec HTTP 200', async () => {
    const manifestRes = await fetch(`${BASE_URL}/static/manifest.json`);
    assert.strictEqual(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assert.strictEqual(manifest.short_name, 'Igitoro');
    assert(manifest.icons.length >= 3);

    for (const iconPath of [
      '/static/icons/icon-180.png',
      '/static/icons/icon-192.png',
      '/static/icons/icon-512.png',
      '/static/icons/icon-maskable-512.png',
      '/static/icons/icon.svg',
      '/apple-touch-icon.png'
    ]) {
      const iconRes = await fetch(`${BASE_URL}${iconPath}`);
      assert.strictEqual(iconRes.status, 200, `Échec sur ${iconPath}`);
      const buf = await iconRes.arrayBuffer();
      assert(buf.byteLength > 200, `Fichier icône vide : ${iconPath}`);
    }
  });

  // ================= 2. API Stations =================
  await test('GET /api/stations retourne la liste des stations', async () => {
    const res = await fetch(`${BASE_URL}/api/stations`);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert(Array.isArray(list));
    assert(list.length >= 28);
  });

  await test('GET /api/stations?q=kinindo filtre correctement', async () => {
    const res = await fetch(`${BASE_URL}/api/stations?q=kinindo`);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert(list.length > 0);
    assert(list.some(s => s.zone.toLowerCase().includes('kinindo') || s.name.toLowerCase().includes('kinindo')));
  });

  await test('GET /api/stations/1 retourne les détails complets de la station', async () => {
    const res = await fetch(`${BASE_URL}/api/stations/1`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, 1);
    assert.strictEqual(data.name, 'Kimoil Fuel Stop');
    assert(data.state);
  });

  // ================= 3. Sécurité & Authentification Google OAuth 2.0 / OIDC =================
  await test('POST /api/auth/google rejette un jeton manquant (HTTP 400)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
  });

  await test('POST /api/auth/google rejette strictement un simple nom saisi par l’utilisateur (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'Alice' })
    });
    assert.strictEqual(res.status, 401);
  });

  await test('POST /api/auth/google rejette strictement les anciennes chaînes mock:nom:Nom (HTTP 401)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'mock:alice:Alice' })
    });
    assert.strictEqual(res.status, 401);
  });

  await test('POST /api/auth/google rejette un jeton JWT falsifié avec mauvaise signature (HTTP 401)', async () => {
    const forgedToken = createSignedTestOidcJwt({
      sub: 'google-sub-forged',
      secret: 'wrong-attacker-secret'
    });
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: forgedToken })
    });
    assert.strictEqual(res.status, 401);
  });

  await test('POST /api/auth/google rejette un jeton JWT OIDC expiré (HTTP 401)', async () => {
    const expiredToken = createSignedTestOidcJwt({
      sub: 'google-sub-expired',
      expOffsetSec: -120
    });
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: expiredToken })
    });
    assert.strictEqual(res.status, 401);
  });

  await test('POST /api/auth/google rejette un jeton JWT OIDC avec mauvaise audience (HTTP 401)', async () => {
    const wrongAudToken = createSignedTestOidcJwt({
      sub: 'google-sub-wrong-aud',
      aud: 'other-unauthorized-app-client-id'
    });
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: wrongAudToken })
    });
    assert.strictEqual(res.status, 401);
  });

  await test('En mode PRODUCTION (NODE_ENV=production), tout jeton de test local est strictement rejeté (HTTP 401)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const devToken = createSignedTestOidcJwt({ sub: 'google-sub-prod-check' });
      let rejected = false;
      try {
        await verifyGoogleOidcToken(devToken);
      } catch (err) {
        rejected = err.status === 401;
      }
      assert.strictEqual(rejected, true, 'Le jeton de test local aurait dû être rejeté en production');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  await test('POST /api/reports sans authentification Google est rejeté (HTTP 401, aucun compte invité créé)', async () => {
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_id: 1,
        fuel_status: 'distribution',
        queue_status: 'short'
      })
    });
    assert.strictEqual(res.status, 401);
  });

  // ================= 4. Cycle complet : Compte nouveau, Déconnexion, Compte existant & Reconnexion =================
  const uniqueSub = `google-oidc-sub-${Date.now()}`;
  let userCookie = '';
  let createdUserId = null;

  await test('Connexion OIDC avec un nouveau sub Google crée un nouveau compte (is_new_user: true)', async () => {
    const validToken = createSignedTestOidcJwt({
      sub: uniqueSub,
      name: 'Jean Testeur',
      email: 'jean.testeur@example.bi'
    });
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: validToken })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.is_new_user, true);
    assert.strictEqual(data.user.sub, uniqueSub);
    assert.strictEqual(data.user.name, 'Jean Testeur');
    createdUserId = data.user.id;
    userCookie = res.headers.get('set-cookie');
    assert(userCookie);
  });

  await test('Déconnexion (POST /api/auth/logout) invalide la session active', async () => {
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': userCookie }
    });
    assert.strictEqual(logoutRes.status, 200);

    // Vérifier que l'ancien cookie ne permet plus d'accéder aux routes protégées
    const checkRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { 'Cookie': userCookie }
    });
    assert.strictEqual(checkRes.status, 401);
  });

  await test('Reconnexion OIDC avec le même sub Google retrouve le compte existant (is_new_user: false, même ID)', async () => {
    const reconnectToken = createSignedTestOidcJwt({
      sub: uniqueSub,
      name: 'Jean Testeur Mis à Jour',
      email: 'jean.testeur@example.bi'
    });
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: reconnectToken })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.is_new_user, false);
    assert.strictEqual(data.user.id, createdUserId);
    assert.strictEqual(data.user.sub, uniqueSub);
    assert.strictEqual(data.user.name, 'Jean Testeur Mis à Jour');
    userCookie = res.headers.get('set-cookie');
    assert(userCookie);
  });

  // ================= 5. Signalements, Confirmations, Abus, Revendications =================
  let createdReportId = null;
  await test('POST /api/reports crée un signalement valide avec utilisateur authentifié', async () => {
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userCookie
      },
      body: JSON.stringify({
        station_id: 2,
        fuel_status: 'distribution',
        fuel_type: 'essence',
        queue_status: 'short',
        approximate_count: '1-10',
        station_open: 'yes',
        comment: 'Essence disponible, pompes fluides'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
    assert(data.report_id);
    createdReportId = data.report_id;
  });

  await test('POST /api/reports/:id/verify enregistre une confirmation', async () => {
    assert(createdReportId);
    const res = await fetch(`${BASE_URL}/api/reports/${createdReportId}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userCookie
      },
      body: JSON.stringify({ kind: 'confirm' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
  });

  await test('POST /api/reports/:id/verify enregistre une contradiction', async () => {
    assert(createdReportId);
    const res = await fetch(`${BASE_URL}/api/reports/${createdReportId}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userCookie
      },
      body: JSON.stringify({ kind: 'no_longer_true' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
  });

  await test('POST /api/reports/:id/abuse enregistre un signalement d’abus', async () => {
    assert(createdReportId);
    const res = await fetch(`${BASE_URL}/api/reports/${createdReportId}/abuse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userCookie
      },
      body: JSON.stringify({
        reason: 'Faux signalement',
        details: 'Station fermée selon observation'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
  });

  let claimId = null;
  await test('POST /api/stations/:id/claim crée une demande de revendication', async () => {
    const res = await fetch(`${BASE_URL}/api/stations/3/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userCookie
      },
      body: JSON.stringify({
        contact_name: 'Alain Gérant',
        phone: '+257 79 123 456',
        role: 'Gérant',
        proof_details: 'Bureau au sein de la station'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
    assert(data.claim_id);
    claimId = data.claim_id;
  });

  // ================= 6. Droits Administrateur & Modération =================
  let adminCookie = '';
  await test('Connexion OIDC compte Administrateur', async () => {
    const adminToken = createSignedTestOidcJwt({
      sub: 'google-oidc-admin-seed-1',
      name: 'Tedd Greg',
      email: 'tedd@example.bi'
    });
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: adminToken })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.user.is_admin, true);
    adminCookie = res.headers.get('set-cookie');
    assert(adminCookie);
  });

  await test('GET /admin accessible pour l’administrateur', async () => {
    const res = await fetch(`${BASE_URL}/admin`, {
      headers: { 'Cookie': adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Tableau de bord Administrateur'));
  });

  await test('GET /admin refuse l’accès pour un utilisateur standard (redirection ou 403)', async () => {
    const res = await fetch(`${BASE_URL}/admin`, {
      headers: { 'Cookie': userCookie },
      redirect: 'manual'
    });
    assert(res.status === 302 || res.status === 403);
  });

  await test('POST /api/admin/claims/:id/moderate approuve une revendication', async () => {
    assert(claimId);
    const res = await fetch(`${BASE_URL}/api/admin/claims/${claimId}/moderate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': adminCookie
      },
      body: JSON.stringify({ action: 'approve' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'approved');

    const stRes = await fetch(`${BASE_URL}/api/stations/3`);
    const stData = await stRes.json();
    assert.strictEqual(stData.is_verified, true);
  });

  await test('POST /api/admin/stations/:id/toggle bascule l’état actif/inactif', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stations/2/toggle`, {
      method: 'POST',
      headers: { 'Cookie': adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(typeof data.active, 'boolean');
  });

  // ================= 7. Suppression de compte =================
  await test('DELETE /api/auth/account supprime et anonymise le compte utilisateur', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Cookie': userCookie }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
  });

  // ================= 8. Système de Partage Complet =================
  await import('../static/js/share.js');
  const IgitoroShare = globalThis.IgitoroShare;

  await test('GET /partager et GET /share affichent l’interface complète et les 8 canaux', async () => {
    for (const route of ['/partager', '/share']) {
      const res = await fetch(`${BASE_URL}${route}`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert(html.includes('Partager Igitoro Live'));
      assert(html.includes('Tu cherches. Tu observes. Tu aides.'));
      assert(html.includes('WhatsApp'));
      assert(html.includes('Instagram'));
      assert(html.includes('Facebook'));
      assert(html.includes('SMS / Messages'));
      assert(html.includes('E-mail'));
      assert(html.includes('Autres applications'));
      assert(html.includes('Partager partout'));
      assert(html.includes('og:image'));
      assert(html.includes('twitter:card'));
    }
  });

  await test('Bouton « 🤝 Partager Igitoro Live » présent sur Accueil, Station, Alertes et Profil', async () => {
    for (const p of ['/', '/stations/1', '/notifications', '/profil']) {
      const res = await fetch(`${BASE_URL}${p}`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert(html.includes('Partager Igitoro Live'), `Bouton absent sur ${p}`);
    }
  });

  await test('GET /api/share/context valide les contextes (général, station, quartier) et n’expose aucune donnée privée', async () => {
    const genRes = await fetch(`${BASE_URL}/api/share/context`);
    assert.strictEqual(genRes.status, 200);
    const genData = await genRes.json();
    assert.strictEqual(genData.context_type, 'general');
    assert(!genData.public_origin.includes('127.0.0.1'));
    assert(!genData.public_origin.includes('localhost'));

    const stRes = await fetch(`${BASE_URL}/api/share/context?station_id=1`);
    assert.strictEqual(stRes.status, 200);
    const stData = await stRes.json();
    assert.strictEqual(stData.context_type, 'station');
    assert.strictEqual(stData.station.id, 1);
    assert(stData.target_url.endsWith('/stations/1'));
    assert(!JSON.stringify(stData).includes('email'));
    assert(!JSON.stringify(stData).includes('google_sub'));

    const zRes = await fetch(`${BASE_URL}/api/share/context?zone=Kinindo`);
    assert.strictEqual(zRes.status, 200);
    const zData = await zRes.json();
    assert.strictEqual(zData.context_type, 'zone');
    assert.strictEqual(zData.zone, 'Kinindo');
  });

  await test('Générateur de contenu : adapte les messages par canal, style et contexte sans garantir de stock', async () => {
    const channels = [
      'everywhere',
      'whatsapp_chat',
      'whatsapp_status',
      'instagram_story',
      'facebook_post',
      'facebook_story',
      'x',
      'sms',
      'email',
      'other_apps'
    ];
    for (const ch of channels) {
      const pkg = IgitoroShare.generateSharePackage({
        channel: ch,
        contextType: 'station',
        station: { id: 1, name: 'Kimoil Fuel Stop', zone: 'Centre-Ville' },
        style: 'community',
        signature: 'Citoyen Bujumbura',
        publicOrigin: 'https://igitorolive.up.railway.app'
      });
      assert(pkg.text.includes('Kimoil Fuel Stop'), `Nom station absent pour ${ch}`);
      assert(pkg.text.includes('Citoyen Bujumbura'), `Signature absente pour ${ch}`);
      assert(pkg.url === 'https://igitorolive.up.railway.app/stations/1');
      assert(!pkg.text.toLowerCase().includes('stock garanti'));
      if (ch === 'instagram_story' || ch === 'whatsapp_status' || ch === 'facebook_story') {
        assert.strictEqual(pkg.visualFormat, 'story');
      } else {
        assert.strictEqual(pkg.visualFormat, 'square');
      }
    }
  });

  await test('Générateur QR Code et Visuels Canvas (Story 1080x1920 et Carré 1080x1080)', async () => {
    const matrix = IgitoroShare.generateQrMatrix('https://igitorolive.up.railway.app/stations/1');
    assert(Array.isArray(matrix) && matrix.length >= 21);
    assert.strictEqual(matrix[0][0], true);
    assert.strictEqual(matrix[0][6], true);

    const drawOps = [];
    const mockCtx = {
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => { drawOps.push('fillRect'); },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      closePath: () => {},
      fill: () => { drawOps.push('fill'); },
      stroke: () => { drawOps.push('stroke'); },
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      fillText: (txt) => { drawOps.push(`text:${txt}`); }
    };

    const storyCanvas = { width: 0, height: 0, getContext: () => mockCtx };
    const storyPkg = IgitoroShare.generateSharePackage({ channel: 'instagram_story' });
    IgitoroShare.renderShareVisualToCanvas(storyCanvas, storyPkg);
    assert.strictEqual(storyCanvas.width, 1080);
    assert.strictEqual(storyCanvas.height, 1920);
    assert(drawOps.some(op => op.includes('Tu cherches. Tu observes. Tu aides.')));
    assert(drawOps.some(op => op.includes('Built by Tedd')));

    const sqCanvas = { width: 0, height: 0, getContext: () => mockCtx };
    const sqPkg = IgitoroShare.generateSharePackage({ channel: 'facebook_post' });
    IgitoroShare.renderShareVisualToCanvas(sqCanvas, sqPkg);
    assert.strictEqual(sqCanvas.width, 1080);
    assert.strictEqual(sqCanvas.height, 1080);
  });

  await test('Web Share API : partage fichier, repli texte+URL, annulation et fallback sans Web Share', async () => {
    const pkg = IgitoroShare.generateSharePackage({ channel: 'everywhere' });
    const fakeCanvas = {
      toBlob: (cb) => cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
    };

    // Cas 1 : Web Share + canShare(files) supporté
    let sharedPayload = null;
    const navWithFiles = {
      canShare: () => true,
      share: async (data) => { sharedPayload = data; }
    };
    const res1 = await IgitoroShare.executeShareAction(pkg, fakeCanvas, { navigator: navWithFiles, forceNative: true });
    assert.strictEqual(res1.mode, 'native_file');
    assert(sharedPayload && Array.isArray(sharedPayload.files));

    // Cas 2 : Web Share supporté mais fichiers refusés par canShare
    const navTextOnly = {
      canShare: () => false,
      share: async (data) => { sharedPayload = data; }
    };
    const res2 = await IgitoroShare.executeShareAction(pkg, fakeCanvas, { navigator: navTextOnly, forceNative: true });
    assert.strictEqual(res2.mode, 'native_text');
    assert.strictEqual(sharedPayload.url, pkg.url);

    // Cas 3 : Annulation par l’utilisateur (AbortError)
    const navCancelled = {
      canShare: () => false,
      share: async () => {
        const err = new Error('User cancelled');
        err.name = 'AbortError';
        throw err;
      }
    };
    const res3 = await IgitoroShare.executeShareAction(pkg, fakeCanvas, { navigator: navCancelled, forceNative: true });
    assert.strictEqual(res3.cancelled, true);
    assert.strictEqual(res3.mode, 'cancelled');

    // Cas 4 : Navigateur sans Web Share -> fallback honnête ou intent officiel
    const igPkg = IgitoroShare.generateSharePackage({ channel: 'instagram_story' });
    const res4 = await IgitoroShare.executeShareAction(igPkg, fakeCanvas, { navigator: {} });
    assert.strictEqual(res4.mode, 'manual_fallback');

    const waPkg = IgitoroShare.generateSharePackage({ channel: 'whatsapp_chat' });
    const res5 = await IgitoroShare.executeShareAction(waPkg, fakeCanvas, { navigator: {} });
    assert.strictEqual(res5.mode, 'channel_intent');
    assert(res5.intentUrl.startsWith('https://wa.me/?text='));
  });

  await test('Sécurité du partage : rejette les URLs dangereuses, domaines externes et balises XSS', async () => {
    const safe1 = IgitoroShare.sanitizeShareUrl('javascript:alert(1)', 'https://igitorolive.up.railway.app');
    assert.strictEqual(safe1, 'https://igitorolive.up.railway.app/');

    const safe2 = IgitoroShare.sanitizeShareUrl('https://evil-phishing.example.com/fake', 'https://igitorolive.up.railway.app');
    assert.strictEqual(safe2, 'https://igitorolive.up.railway.app/');

    const safeOrigin = IgitoroShare.resolvePublicShareOrigin('http://127.0.0.1:3000', 'http://localhost:3000');
    assert.strictEqual(safeOrigin, 'https://igitorolive.up.railway.app');

    const cleanTxt = IgitoroShare.sanitizeText('<script>alert(1)</script>Bonjour');
    assert(!cleanTxt.includes('<script>'));
    assert(cleanTxt.includes('Bonjour'));

    const evRes = await fetch(`${BASE_URL}/api/share/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'share_opened', channel: 'whatsapp_chat' })
    });
    assert.strictEqual(evRes.status, 200);
  });

  console.log(`\n========================================`);
  console.log(`Résultats : ${passed} passés, ${failed} échoués`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erreur critique d’exécution des tests :', err);
  process.exit(1);
});
