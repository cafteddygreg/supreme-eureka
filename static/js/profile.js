async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

async function deleteAccount() {
  if (!confirm('Supprimer définitivement votre compte ?')) return;
  const r = await fetch('/api/auth/account', { method: 'DELETE' });
  if (r.ok) {
    window.location.href = '/';
  }
}

async function deleteReport(id) {
  if (!confirm('Supprimer ce signalement ?')) return;
  const r = await fetch('/api/reports/' + id, { method: 'DELETE' });
  if (r.ok) {
    window.location.reload();
  }
}

// Callback officiel Google Identity Services (OpenID Connect ID Token)
async function handleGoogleCredentialResponse(response) {
  const errEl = document.getElementById('auth-error-msg');
  if (errEl) errEl.textContent = '';

  if (!response || !response.credential) {
    if (errEl) errEl.textContent = 'Jeton Google OIDC manquant.';
    return;
  }

  try {
    const r = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const d = await r.json();
    if (r.ok) {
      window.location.reload();
    } else if (errEl) {
      errEl.textContent = d.detail || 'Échec de la vérification Google OIDC.';
    }
  } catch (e) {
    if (errEl) errEl.textContent = 'Erreur réseau lors de la vérification Google.';
  }
}

// Flux OAuth 2.0 / OpenID Connect avec redirection vers accounts.google.com
async function startGoogleOAuthLogin() {
  const errEl = document.getElementById('auth-error-msg');
  if (errEl) errEl.textContent = '';

  try {
    const redirectUri = `${window.location.origin}/auth/callback`;
    const r = await fetch(`/api/auth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
    const d = await r.json();

    if (!r.ok || !d.url) {
      if (errEl) {
        errEl.textContent = d.detail || 'Impossible d’initialiser la connexion Google OAuth 2.0.';
      }
      return;
    }

    // Si intégré dans un iframe (ex: aperçu AI Studio), ouvrir l'URL Google dans une fenêtre dédiée
    const isInIframe = window.self !== window.top;
    if (isInIframe) {
      window.open(d.url, 'google_oauth_popup', 'width=540,height=660');
    } else {
      window.location.href = d.url;
    }
  } catch (e) {
    if (errEl) {
      errEl.textContent = 'Erreur réseau lors de la connexion à Google OAuth 2.0.';
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'OAUTH_AUTH_SUCCESS') {
    window.location.reload();
  }
});

async function toggleZone(b, z) {
  const on = b.classList.contains('selected');
  const r = await fetch('/api/notifications/' + (on ? 'unsubscribe' : 'subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: z })
  });
  if (r.ok) {
    b.classList.toggle('selected');
    b.textContent = z + (on ? ' +' : ' ✓');
  } else if (r.status === 401) {
    window.location.href = '/profil';
  }
}
