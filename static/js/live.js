// Système d'auto-actualisation en temps réel d'Igitoro Live (Server-Sent Events + Repli intelligent sans recharger toute la page)
(function () {
  const STATUS_LABELS = {
    distribution: 'On distribue',
    no_fuel: 'Pas de carburant',
    starting: 'Ça semble commencer',
    unknown: 'Pas d’information récente'
  };

  let currentVersion = null;
  let isSyncing = false;
  let sseSource = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildFuelBadgeHtml(fuelType) {
    if (fuelType === 'essence') {
      return '<span class="chip" style="background: var(--amber-soft); color: var(--amber-dark); font-size: 0.72rem; padding: 2px 7px; font-weight: 700;">⛽ Juste Essence</span>';
    }
    if (fuelType === 'mazout') {
      return '<span class="chip" style="background: var(--pine-soft); color: var(--pine); font-size: 0.72rem; padding: 2px 7px; font-weight: 700;">🛢️ Juste Mazout</span>';
    }
    if (fuelType === 'both') {
      return '<span class="chip" style="background: var(--emerald-100); color: var(--emerald-600); font-size: 0.72rem; padding: 2px 7px; font-weight: 700;">⛽🛢️ Essence &amp; Mazout</span>';
    }
    return '';
  }

  function renderStationCardHtml(s) {
    const state = s.state || {
      status: 'unknown',
      fuel_type: 'unspecified',
      queue: 'unknown',
      freshness: 'Aucun signalement récent'
    };
    const statusText = STATUS_LABELS[state.status] || 'Pas d’information récente';
    const fuelBadge = buildFuelBadgeHtml(state.fuel_type);
    const searchData = `${s.name || ''} ${s.brand || ''} ${s.commune || ''} ${s.zone || ''} ${s.landmark || ''} ${s.location_text || s.location || ''}`.toLowerCase();

    return `
      <article 
        class="card station-card" 
        data-id="${s.id}"
        data-name="${escapeHtml((s.name || '').toLowerCase())}" 
        data-brand="${escapeHtml((s.brand || '').toLowerCase())}" 
        data-commune="${escapeHtml((s.commune || '').toLowerCase())}" 
        data-zone="${escapeHtml((s.zone || '').toLowerCase())}" 
        data-search="${escapeHtml(searchData)}"
      >
        <div>
          <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
            ${s.commune ? `<span class="chip" style="background: var(--pine); color: white; font-size: 0.75rem; padding: 4px 8px;">${escapeHtml(s.commune)}</span>` : ''}
            <span class="chip">${escapeHtml(s.zone)}</span>
            ${s.brand ? `<span class="chip" style="background: var(--amber-soft); color: var(--amber); font-weight: 600;">${escapeHtml(s.brand)}</span>` : ''}
          </div>
          <h2><a href="/stations/${s.id}">${escapeHtml(s.name)}</a></h2>
          <p>${escapeHtml(s.location_text || s.location || '')}</p>
          ${s.landmark ? `<small style="color: var(--muted); display: block; margin-top: 4px;">${escapeHtml(s.landmark)}</small>` : ''}
        </div>
        <div class="state">
          <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 4px;">
            <b>${escapeHtml(statusText)}</b>
            ${fuelBadge}
          </div>
          <small>${escapeHtml(state.queue || 'unknown')} · ${escapeHtml(state.freshness || '')}</small>
        </div>
      </article>
    `;
  }

  function updateCommuneCounts(stations) {
    const counts = {
      all: stations.length,
      mukaza: 0,
      muha: 0,
      ntahangwa: 0
    };
    for (const s of stations) {
      const c = String(s.commune || '').toLowerCase();
      if (c === 'mukaza') counts.mukaza++;
      else if (c === 'muha') counts.muha++;
      else if (c === 'ntahangwa') counts.ntahangwa++;
    }

    document.querySelectorAll('.filter-chip').forEach(chip => {
      const commune = (chip.dataset.commune || '').toLowerCase();
      const badge = chip.querySelector('.chip-count');
      if (!badge) return;
      if (!commune) badge.textContent = String(counts.all);
      else if (commune === 'mukaza') badge.textContent = String(counts.mukaza);
      else if (commune === 'muha') badge.textContent = String(counts.muha);
      else if (commune === 'ntahangwa') badge.textContent = String(counts.ntahangwa);
    });
  }

  async function refreshHomeStationsInPlace() {
    const listEl = document.getElementById('stationsList');
    if (!listEl) return false;

    const res = await fetch('/api/stations?all=1', { cache: 'no-store' });
    if (!res.ok) return false;
    const stations = await res.json();
    if (!Array.isArray(stations)) return false;

    listEl.innerHTML = stations.map(renderStationCardHtml).join('');
    updateCommuneCounts(stations);

    if (typeof window.applyStationFilters === 'function') {
      window.applyStationFilters();
    }
    return true;
  }

  async function refreshCurrentPageContentInPlace() {
    const path = window.location.pathname;

    // 1. Page d'accueil : mise à jour directe de la liste des stations en conservant la recherche et les filtres
    if (path === '/') {
      return await refreshHomeStationsInPlace();
    }

    // 2. Page détail d'une station ou page Alertes : ne pas interrompre si un modal ou formulaire est ouvert
    const openModal = document.querySelector('.modal:not(.hidden)');
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (openModal || activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
      return false;
    }

    if (path.startsWith('/stations/') || path === '/notifications') {
      const res = await fetch(window.location.href, {
        cache: 'no-store',
        headers: { 'X-Requested-With': 'IgitoroLiveAutoRefresh' }
      });
      if (!res.ok) return false;
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const newMain = doc.querySelector('main.app-main');
      const currentMain = document.querySelector('main.app-main');
      if (newMain && currentMain) {
        currentMain.innerHTML = newMain.innerHTML;
        return true;
      }
    }
    return false;
  }

  async function syncIfNeeded(forceRefresh = false) {
    if (isSyncing || document.hidden) return;
    isSyncing = true;
    try {
      const res = await fetch('/api/live/version', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || typeof data.version !== 'number') return;

      if (currentVersion === null) {
        currentVersion = data.version;
        if (forceRefresh) {
          await refreshCurrentPageContentInPlace();
        }
        return;
      }

      if (data.version !== currentVersion || forceRefresh) {
        currentVersion = data.version;
        await refreshCurrentPageContentInPlace();
      }
    } catch (_) {
    } finally {
      isSyncing = false;
    }
  }

  function connectLiveStream() {
    if (!('EventSource' in window)) return;
    try {
      if (sseSource) {
        sseSource.close();
      }
      sseSource = new EventSource('/api/live/events');

      sseSource.addEventListener('connected', (e) => {
        try {
          const payload = JSON.parse(e.data || '{}');
          if (typeof payload.version === 'number') {
            if (currentVersion !== null && payload.version !== currentVersion) {
              syncIfNeeded(true);
            } else {
              currentVersion = payload.version;
            }
          }
        } catch (_) {}
      });

      sseSource.addEventListener('update', (e) => {
        try {
          const payload = JSON.parse(e.data || '{}');
          if (typeof payload.version === 'number') {
            currentVersion = payload.version;
          }
          refreshCurrentPageContentInPlace();
        } catch (_) {}
      });

      sseSource.onerror = () => {
        // EventSource gère la reconnexion automatique ; le polling de secours prend le relais
      };
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    syncIfNeeded(false);
    connectLiveStream();

    // Vérification périodique toutes les 20s (au cas où un proxy coupe le flux SSE et pour rafraîchir "Il y a X min")
    setInterval(() => {
      if (!document.hidden) {
        if (window.location.pathname === '/') {
          refreshHomeStationsInPlace().catch(() => {});
        } else {
          syncIfNeeded(false);
        }
      }
    }, 20000);

    // Dès que l'utilisateur revient sur l'onglet ou déverrouille son téléphone, actualiser immédiatement
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncIfNeeded(true);
      }
    });
  });
})();
