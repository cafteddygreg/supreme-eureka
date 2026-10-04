let selectedCommunes = new Set();

function normalizeText(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function handleSearch(query) {
  const searchInput = document.getElementById('stationSearchInput');
  const val = typeof query === 'string' ? query : (searchInput ? searchInput.value : '');
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) {
    if (val && val.trim().length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
  applyStationFilters();
}

function toggleCommuneFilter(commune) {
  const normalized = commune ? commune.trim() : '';

  if (!normalized) {
    selectedCommunes.clear();
  } else {
    if (selectedCommunes.has(normalized)) {
      selectedCommunes.delete(normalized);
    } else {
      selectedCommunes.add(normalized);
    }
  }

  updateCommuneChipUI();
  applyStationFilters();
}

function resetCommuneFilter() {
  selectedCommunes.clear();
  updateCommuneChipUI();
  applyStationFilters();
}

function updateCommuneChipUI() {
  const chips = document.querySelectorAll('.filter-chip');
  const isAll = selectedCommunes.size === 0;

  chips.forEach(chip => {
    const chipCommune = chip.dataset.commune || '';
    const countBadge = chip.querySelector('.chip-count');

    if (!chipCommune) {
      if (isAll) {
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        if (countBadge) {
          countBadge.style.background = 'rgba(255,255,255,0.25)';
          countBadge.style.color = '#ffffff';
        }
      } else {
        chip.classList.remove('selected');
        chip.setAttribute('aria-pressed', 'false');
        if (countBadge) {
          countBadge.style.background = 'var(--pine-soft)';
          countBadge.style.color = 'var(--pine)';
        }
      }
    } else {
      const isSelected = selectedCommunes.has(chipCommune);
      if (isSelected) {
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        if (countBadge) {
          countBadge.style.background = 'rgba(255,255,255,0.25)';
          countBadge.style.color = '#ffffff';
        }
      } else {
        chip.classList.remove('selected');
        chip.setAttribute('aria-pressed', 'false');
        if (countBadge) {
          countBadge.style.background = 'var(--pine-soft)';
          countBadge.style.color = 'var(--pine)';
        }
      }
    }
  });

  const activeLabel = document.getElementById('activeCommuneLabel');
  if (activeLabel) {
    if (selectedCommunes.size > 0) {
      activeLabel.textContent = `Commune(s) : ${Array.from(selectedCommunes).join(', ')}`;
    } else {
      activeLabel.textContent = '';
    }
  }
}

function clearSearch() {
  const searchInput = document.getElementById('stationSearchInput');
  if (searchInput) {
    searchInput.value = '';
  }
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) {
    clearBtn.classList.add('hidden');
  }

  selectedCommunes.clear();
  updateCommuneChipUI();
  applyStationFilters();

  if (searchInput) {
    searchInput.focus();
  }
}

function applyStationFilters() {
  const searchInput = document.getElementById('stationSearchInput');
  const rawQuery = searchInput ? searchInput.value : '';
  const normalizedQuery = normalizeText(rawQuery);
  const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];

  const cards = document.querySelectorAll('.station-card');
  let visibleCount = 0;

  cards.forEach(card => {
    const name = normalizeText(card.dataset.name || '');
    const brand = normalizeText(card.dataset.brand || '');
    const commune = normalizeText(card.dataset.commune || '');
    const zone = normalizeText(card.dataset.zone || '');
    const textContent = normalizeText(card.textContent || '');
    const fullSearch = normalizeText(
      card.dataset.search || `${name} ${brand} ${commune} ${zone} ${textContent}`
    );

    // Check commune filter
    let matchesCommune = true;
    if (selectedCommunes.size > 0) {
      matchesCommune = false;
      for (const sel of selectedCommunes) {
        if (normalizeText(sel) === commune) {
          matchesCommune = true;
          break;
        }
      }
    }

    // Check query tokens against name, brand, commune, zone, or card text
    let matchesQuery = true;
    if (queryTokens.length > 0) {
      matchesQuery = queryTokens.every(token => {
        return (
          name.includes(token) ||
          brand.includes(token) ||
          commune.includes(token) ||
          zone.includes(token) ||
          fullSearch.includes(token)
        );
      });
    }

    const shouldShow = matchesCommune && matchesQuery;
    card.hidden = !shouldShow;
    card.classList.toggle('hidden', !shouldShow);
    card.style.display = shouldShow ? '' : 'none';

    if (shouldShow) {
      visibleCount++;
    }
  });

  // Update counter
  const resultsCount = document.getElementById('resultsCount');
  if (resultsCount) {
    const totalCount = cards.length;
    if (queryTokens.length > 0 || selectedCommunes.size > 0) {
      resultsCount.innerHTML = `<strong>${visibleCount}</strong> station${visibleCount > 1 ? 's' : ''} trouvée${visibleCount > 1 ? 's' : ''} sur ${totalCount}`;
    } else {
      resultsCount.innerHTML = `<strong>${totalCount}</strong> stations répertoriées`;
    }
  }

  // Update no-results message
  const noResultsMsg = document.getElementById('noResultsMessage');
  if (noResultsMsg) {
    if (visibleCount === 0) {
      noResultsMsg.classList.remove('hidden');
    } else {
      noResultsMsg.classList.add('hidden');
    }
  }
}

// Attacher également les écouteurs directement au champ de recherche dès le chargement
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('stationSearchInput');
  if (searchInput) {
    ['input', 'keyup', 'search', 'change'].forEach(evt => {
      searchInput.addEventListener(evt, () => handleSearch(searchInput.value));
    });
    if (searchInput.value) {
      handleSearch(searchInput.value);
    }
  }
});
