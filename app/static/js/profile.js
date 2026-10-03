function handleCredentialResponse(response) {
    fetch('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            window.location.href = '/';
        } else {
            alert('Erreur de connexion');
        }
    })
    .catch(err => {
        console.error('Erreur:', err);
        alert('Erreur réseau');
    });
}

function loginWithGoogleMock() {
    // Pour le développement sans vrai Google Client ID
    fetch('/auth/google/mock', { method: 'POST' })
        .then(() => window.location.reload());
}

function logout() {
    fetch('/auth/logout', { method: 'POST' })
        .then(() => window.location.href = '/');
}

function deleteAccount() {
    if (confirm('Supprimer votre compte et toutes vos données ?')) {
        fetch('/auth/account', { method: 'DELETE' })
            .then(() => window.location.href = '/');
    }
}

function deleteReport(id) {
    if (confirm('Supprimer ce signalement ?')) {
        fetch('/api/reports/' + id, { method: 'DELETE' })
            .then(() => window.location.reload());
    }
}

async function toggleZone(b, z) {
    let on = b.classList.contains('selected');
    let r = await fetch('/api/notifications/' + (on ? 'unsubscribe' : 'subscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: z })
    });
    if (r.ok) {
        b.classList.toggle('selected');
        b.textContent = z + (on ? ' +' : ' ✓');
    }
}
