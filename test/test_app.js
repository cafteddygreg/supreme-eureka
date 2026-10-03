import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:3000';

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

  // 1. Routes web principales (HTML / EJS)
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

  await test('GET /profil répond avec HTTP 200', async () => {
    const res = await fetch(`${BASE_URL}/profil`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('Profil'));
  });

  await test('GET /health répond avec status ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
  });

  // 2. API Stations
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

  // 3. Authentification & Sessions
  let userCookie = '';
  await test('POST /api/auth/google permet la connexion utilisateur', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'mock:testuser42:Jean Testeur' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
    assert.strictEqual(data.user.name, 'Jean Testeur');
    userCookie = res.headers.get('set-cookie');
    assert(userCookie);
  });

  // 4. Signalements (Reports)
  let createdReportId = null;
  await test('POST /api/reports crée un signalement valide', async () => {
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

  // 5. Confirmation / Contradiction
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

  // 6. Signalement d'abus
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

  // 7. Revendication de station
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

  // 8. Droits Administrateur & Modération
  // Connexion en tant qu'admin (demo user 1)
  let adminCookie = '';
  await test('Connexion compte Administrateur', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'mock:demo:Tedd Greg' })
    });
    assert.strictEqual(res.status, 200);
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

    // Vérifier que la station est passée en "is_verified"
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

  // 9. Suppression de compte (Anonymisation propre)
  await test('DELETE /api/auth/account supprime et anonymise le compte utilisateur', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Cookie': userCookie }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.ok);
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
