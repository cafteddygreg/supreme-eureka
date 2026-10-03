let abuseId = null;
let activeCameraStream = null;
let livePhotoBlob = null;
let livePhotoCapturedAt = null;

// Bloquer strictement tout glisser-déposer de fichiers depuis le disque dur / explorateur
window.addEventListener('dragover', function(e) {
  e.preventDefault();
  e.stopPropagation();
});
window.addEventListener('drop', function(e) {
  e.preventDefault();
  e.stopPropagation();
});

// ================= Caméra en direct pure (Zéro fichier / Zéro disque dur / Zéro galerie) =================

async function openLiveCamera() {
  const container = document.getElementById('camera-stream-container');
  const initial = document.getElementById('camera-initial-state');
  const preview = document.getElementById('camera-snapshot-preview');
  const errorMsg = document.getElementById('camera-error-message');
  const video = document.getElementById('live-video-feed');

  if (errorMsg) errorMsg.classList.add('hidden');
  if (preview) preview.classList.add('hidden');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (errorMsg) errorMsg.classList.remove('hidden');
    if (initial) initial.classList.add('hidden');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    activeCameraStream = stream;
    if (video) {
      video.srcObject = stream;
      await video.play();
    }

    if (initial) initial.classList.add('hidden');
    if (container) container.classList.remove('hidden');
  } catch (err) {
    console.warn('Accès caméra non accordé ou indisponible :', err);
    if (errorMsg) errorMsg.classList.remove('hidden');
    if (initial) initial.classList.add('hidden');
  }
}

function stopLiveCamera() {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach(track => track.stop());
    activeCameraStream = null;
  }
  const container = document.getElementById('camera-stream-container');
  const initial = document.getElementById('camera-initial-state');
  if (container) container.classList.add('hidden');
  if (initial && !livePhotoBlob) initial.classList.remove('hidden');
}

function takeLiveSnapshot() {
  const video = document.getElementById('live-video-feed');
  const canvas = document.getElementById('hidden-capture-canvas');
  const preview = document.getElementById('camera-snapshot-preview');
  const previewImg = document.getElementById('snapshot-img-preview');
  const container = document.getElementById('camera-stream-container');

  if (!video || !canvas) return;

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  // Filigrane indélébile de direct certifié
  const now = new Date();
  const bannerHeight = Math.max(34, Math.round(height * 0.07));
  ctx.fillStyle = 'rgba(10, 28, 19, 0.90)';
  ctx.fillRect(0, height - bannerHeight, width, bannerHeight);

  ctx.fillStyle = '#22C55E';
  ctx.font = `bold ${Math.max(13, Math.round(bannerHeight * 0.42))}px sans-serif`;
  ctx.textBaseline = 'middle';
  const timestampStr = now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR');
  ctx.fillText('🔴 PRISE DIRECTE SUR PLACE · IGITORO BUJUMBURA · ' + timestampStr, 14, height - (bannerHeight / 2));

  canvas.toBlob(blob => {
    livePhotoBlob = blob;
    livePhotoCapturedAt = now.getTime();

    const capturedAtField = document.getElementById('photo_captured_at');
    if (capturedAtField) capturedAtField.value = now.toISOString();

    if (previewImg) previewImg.src = URL.createObjectURL(blob);
    if (container) container.classList.add('hidden');
    if (preview) preview.classList.remove('hidden');

    stopLiveCamera();
  }, 'image/jpeg', 0.90);
}

function retakeLivePhoto() {
  removeLivePhoto();
  openLiveCamera();
}

function removeLivePhoto() {
  livePhotoBlob = null;
  livePhotoCapturedAt = null;
  const capturedAtField = document.getElementById('photo_captured_at');
  if (capturedAtField) capturedAtField.value = '';

  const preview = document.getElementById('camera-snapshot-preview');
  const initial = document.getElementById('camera-initial-state');
  const errorMsg = document.getElementById('camera-error-message');

  if (preview) preview.classList.add('hidden');
  if (errorMsg) errorMsg.classList.add('hidden');
  if (initial) initial.classList.remove('hidden');
}

// ================= Soumission du signalement =================

async function submitReport(e) {
  e.preventDefault();
  const form = e.target;
  const msgEl = document.getElementById('report-message');
  msgEl.textContent = 'Envoi en cours…';
  msgEl.style.color = 'var(--pine)';

  const formData = new FormData(form);

  // Joindre uniquement le blob issu de la caméra en direct
  if (livePhotoBlob) {
    formData.set('photo', livePhotoBlob, `camera-direct-${Date.now()}.jpg`);
    formData.set('photo_captured_at', livePhotoCapturedAt ? livePhotoCapturedAt.toString() : Date.now().toString());
  }

  try {
    const r = await fetch('/api/reports', {
      method: 'POST',
      body: formData
    });
    const d = await r.json();

    if (r.ok) {
      msgEl.textContent = '✓ Signalement enregistré avec succès.';
      msgEl.style.color = 'var(--emerald-600)';
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } else {
      msgEl.textContent = d.detail || 'Erreur lors de l’envoi.';
      msgEl.style.color = 'var(--crimson)';
    }
  } catch (err) {
    console.error('Erreur:', err);
    msgEl.textContent = 'Erreur réseau. Veuillez réessayer.';
    msgEl.style.color = 'var(--crimson)';
  }
}

function toggleNewStation() {
  const fields = document.getElementById('new-station-fields');
  const toggle = document.getElementById('new-station-toggle');
  if (fields && toggle) {
    fields.classList.toggle('hidden', !toggle.checked);
  }
}

async function createAndSelectStation() {
  const nameInput = document.getElementById('new-station-name');
  const brandInput = document.getElementById('new-station-brand');
  const zoneInput = document.getElementById('new-station-zone');
  const locInput = document.getElementById('new-station-location');

  const payload = {
    name: nameInput.value.trim(),
    brand: brandInput.value.trim(),
    zone: zoneInput.value.trim(),
    location_text: locInput.value.trim()
  };

  if (!payload.name || !payload.zone || !payload.location_text) {
    return alert('Veuillez remplir au moins le nom, la zone et la localisation de la station.');
  }

  const r = await fetch('/api/stations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const d = await r.json();

  if (!r.ok) return alert(d.detail || 'Erreur lors de l’inscription de la station');

  const s = document.querySelector('[name=station_id]');
  s.add(new Option(payload.name + ' — ' + payload.zone, d.station_id, true, true));
  document.getElementById('new-station-toggle').checked = false;
  toggleNewStation();
}

async function verifyReport(id, kind) {
  const r = await fetch('/api/reports/' + id + '/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind })
  });
  if (r.ok) location.reload();
  else {
    const d = await r.json();
    alert(d.detail || 'Erreur');
  }
}

function openAbuseModal(id) {
  abuseId = id;
  const modal = document.getElementById('abuse-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeAbuseModal() {
  const modal = document.getElementById('abuse-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitAbuse() {
  const reasonEl = document.querySelector('[name=abuse_reason]:checked');
  const detailsEl = document.getElementById('abuse-details');
  const reason = reasonEl ? reasonEl.value : 'Autre';
  const details = detailsEl ? detailsEl.value : '';

  const r = await fetch('/api/reports/' + abuseId + '/abuse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, details })
  });

  if (r.ok) {
    closeAbuseModal();
    alert('Signalement d’abus transmis. Merci.');
  } else {
    alert('Impossible d’envoyer le signalement.');
  }
}
