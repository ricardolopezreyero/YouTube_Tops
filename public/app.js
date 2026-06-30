/**
 * app.js – YouTube Tops · sin autenticación · RLR · EYE·181218
 *
 * Perfil único guardado en Cloudflare KV vía /api/profile.
 * Mismo perfil en cualquier dispositivo — sin localStorage, sin tokens.
 *
 * REGLA TDZ: todos los const ANTES de cualquier addEventListener.
 */

import { logger } from './logger.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const WEIGHT_KEYS   = ['engagement', 'relevance', 'depth', 'duration', 'captions', 'authority'];

// ── Utilidades ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function pad(n)        { return String(n).padStart(2, '0'); }
function fmtDuration(s) {
  if (!s) return '?';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function fmtViews(n) {
  if (!n) return '0';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
       : n >= 1_000     ? `${(n / 1_000).toFixed(0)}K`
       : String(n);
}
function scoreBadgeClass(s) { return s >= 0.6 ? 'score-hi' : s >= 0.35 ? 'score-mid' : 'score-lo'; }
function uid()   { return Math.random().toString(36).slice(2, 10); }

function showToast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), ms);
}

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  rawVideos: [], offset: 0, hasMore: false, loading: false,
  weights:   { engagement: 35, relevance: 25, depth: 15, duration: 10, captions: 5, authority: 10 },
  keywords:  [],
  description: '', derivedSeeds: [],
  durMin: 8, durMax: 60, mode: 'balanced',
  feedback:  {},
  lists:     [],
  listItems: {},
  currentView: 'home', currentListId: null, pendingAddVideoListId: null,
  activeDurFilter: 'all', onlyNew: false,
  sessionMinutes: 45,
  // Sync
  _remoteV: 0,  // última versión recibida del servidor
  _ownV:    0,  // versión que nosotros escribimos (para ignorar nuestros propios saves)
};

// ── Perfil remoto (Cloudflare KV vía /api/profile) ────────────────────────────
// Mismo perfil en cualquier dispositivo — sin localStorage, sin login.
async function fetchProfile() {
  try {
    const p = await apiFetch('/api/profile');
    state._remoteV = p._v || 0;
    return p;
  }
  catch (e) { console.warn('fetchProfile:', e.message); return {}; }
}
function buildProfilePayload() {
  return {
    description:       state.description,
    derived_seeds:     state.derivedSeeds,
    interest_keywords: state.keywords,
    weights:           { ...state.weights },
    settings:          { mode: state.mode, duration_min: state.durMin, duration_max: state.durMax },
    feedback:          state.feedback,
    lists:             state.lists,
    listItems:         state.listItems,
  };
}
function persistProfile() {
  const v = Date.now();
  state._ownV = v;
  apiFetch('/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...buildProfilePayload(), _v: v }),
  }).catch(e => console.warn('persistProfile:', e.message));
}

// ── Sync en tiempo real (polling 2.5 s con diff inteligente) ──────────────────
let _syncBusy = false;

function startSyncLoop() {
  setInterval(async () => {
    if (_syncBusy || document.hidden) return;
    _syncBusy = true;
    try {
      const remote = await apiFetch('/api/profile');
      const rv = remote._v || 0;
      if (!rv || rv === state._remoteV) return;       // sin cambios
      if (rv === state._ownV) { state._remoteV = rv; return; } // nuestro propio save
      logger.info('Sync: cambios de otro dispositivo detectados', { rv });
      applyRemoteDiff(remote);
      state._remoteV = rv;
    } catch { /* silencioso */ }
    finally { _syncBusy = false; }
  }, 2500);
}

function applyRemoteDiff(remote) {
  // ── 1. Lista activa: items añadidos / eliminados / razón actualizada ──────
  if (state.currentView === 'list' && state.currentListId) {
    const lid         = state.currentListId;
    const localItems  = state.listItems[lid]  || {};
    const remoteItems = remote.listItems?.[lid] || {};

    // Items eliminados en otro dispositivo
    for (const vid of Object.keys(localItems)) {
      if (!remoteItems[vid]) {
        const card = $(`listrow-${CSS.escape(vid)}`);
        if (card) {
          card.style.transition = 'opacity .22s, transform .22s';
          card.style.opacity = '0'; card.style.transform = 'scale(0.97) translateX(8px)';
          setTimeout(() => { card.remove(); checkListEmpty(lid); }, 240);
        }
      }
    }

    // Items añadidos en otro dispositivo
    const sorted = Object.entries(remoteItems).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
    const total  = sorted.length;
    sorted.forEach(([vid, data], idx) => {
      if (!localItems[vid]) {
        animateListCardIn(vid, data, idx, total);
        $('list-empty-state')?.classList.add('hidden');
      } else if (data.reason && data.reason !== localItems[vid].reason) {
        // Razón IA llegó desde otro dispositivo o background job
        const el = $(`reason-${CSS.escape(vid)}`);
        if (el) {
          el.textContent = data.reason;
          el.classList.remove('hidden');
          el.style.transition = 'opacity .3s';
          el.style.opacity = '0';
          requestAnimationFrame(() => { el.style.opacity = '1'; });
        }
      }
    });

    // Nombre de lista renombrada
    const remoteList = (remote.lists || []).find(l => l.id === lid);
    const nameEl = $('list-view-name');
    if (remoteList && nameEl && nameEl.textContent !== remoteList.name)
      nameEl.textContent = remoteList.name;
  }

  // ── 2. Grid principal: dismissals y clicks desde otro dispositivo ─────────
  for (const [vid, fb] of Object.entries(remote.feedback || {})) {
    const local = state.feedback[vid] || {};
    if (fb.dismissed && !local.dismissed) {
      const card = $(`card-${CSS.escape(vid)}`);
      if (card) {
        card.style.transition = 'opacity .28s, transform .28s';
        card.style.opacity = '0'; card.style.transform = 'scale(0.92)';
        setTimeout(() => card.remove(), 300);
      }
    }
    if ((fb.clicks || 0) !== (local.clicks || 0)) {
      const badge = $(`clk-${CSS.escape(vid)}`);
      if (badge) {
        const c = fb.clicks || 0;
        badge.textContent = `${c} clic${c !== 1 ? 's' : ''}`;
        badge.classList.toggle('hidden', c === 0);
      }
    }
  }

  // ── 3. Keywords cambiadas ─────────────────────────────────────────────────
  if (JSON.stringify(remote.interest_keywords) !== JSON.stringify(state.keywords)) {
    state.keywords = remote.interest_keywords || [];
    renderKeywordChips();
  }

  // ── 4. Aplicar todo al estado (pesos, settings, listas, etc.) ────────────
  applyProfileToState(remote);

  showSyncPulse();
}

function animateListCardIn(videoId, data, idx, total) {
  const container = $('list-items-container');
  if (!container) return;
  const card = buildListItemRow(videoId, data, idx, total);
  card.style.opacity = '0';
  card.style.transform = 'translateY(-10px)';
  card.style.transition = 'opacity .28s ease, transform .28s ease';

  // Insertar en posición correcta según order
  const existing = container.querySelectorAll('.list-card');
  let inserted = false;
  for (const el of existing) {
    const elOrder = parseInt(el.dataset.order || '9999');
    if ((data.order || 0) < elOrder) {
      container.insertBefore(card, el); inserted = true; break;
    }
  }
  if (!inserted) container.appendChild(card);
  card.dataset.order = String(data.order || idx);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  }));
}

function checkListEmpty(listId) {
  const container = $('list-items-container');
  const hasCards  = container && container.querySelectorAll('.list-card').length > 0;
  $('list-empty-state')?.classList.toggle('hidden', hasCards);
}

function showSyncPulse() {
  const dot = $('sync-dot');
  if (!dot) return;
  dot.classList.remove('sync-dot--pulse');
  void dot.offsetWidth; // reflow para reiniciar animación
  dot.classList.add('sync-dot--pulse');
}

// ── Pantallas ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── API fetch (sin auth) ──────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const t   = logger.time(url);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  t.end({ status: res.status });
  return data;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const descInput = $('description-input'), charCount = $('char-count');
descInput.addEventListener('input', () => { charCount.textContent = descInput.value.length; });

function showOnboardStep(step) {
  document.querySelectorAll('.onboard-step').forEach(s => s.classList.remove('active'));
  $(`onboard-step-${step}`).classList.add('active');
}
$('btn-onboard-next').addEventListener('click', () => showOnboardStep(2));
$('btn-onboard-back').addEventListener('click', () => showOnboardStep(1));

document.querySelectorAll('.ob-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    descInput.value = chip.dataset.text;
    charCount.textContent = descInput.value.length;
    descInput.focus();
  });
});

$('btn-save-profile').addEventListener('click', async () => {
  const btn     = $('btn-save-profile');
  const errEl   = $('onboard-error');
  const label   = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.btn-spinner');
  errEl.classList.add('hidden');
  const description = descInput.value.trim();
  if (description.length < 20) {
    errEl.textContent = 'Escribe al menos 20 caracteres.';
    errEl.classList.remove('hidden'); return;
  }
  btn.disabled = true; label.textContent = 'Procesando…'; spinner.classList.remove('hidden');
  try {
    const { seeds, keywords, suggested_lists } = await apiFetch('/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const newLists = (suggested_lists || ['Ver después', 'Favoritos', 'Comparte esto'])
      .map((name, i) => ({ id: uid(), name, order: i, created_at: new Date().toISOString() }));

    state.description   = description;
    state.derivedSeeds  = seeds;
    state.keywords      = keywords;
    state.lists         = newLists;
    state.listItems     = {};
    newLists.forEach(l => { state.listItems[l.id] = {}; });
    persistProfile();

    showScreen('screen-app');
    renderListsBadge();
    loadVideos(true);
  } catch (err) {
    errEl.textContent = err.message; errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; label.textContent = 'Generar mi perfil →'; spinner.classList.add('hidden');
  }
});

// ── Feedback ──────────────────────────────────────────────────────────────────
function trackClick(videoId) {
  if (!state.feedback[videoId]) state.feedback[videoId] = { clicks: 0, dismissed: false };
  state.feedback[videoId].clicks = (state.feedback[videoId].clicks || 0) + 1;
  const badge = $(`clk-${CSS.escape(videoId)}`);
  const c     = state.feedback[videoId].clicks;
  if (badge) { badge.textContent = `${c} clic${c > 1 ? 's' : ''}`; badge.classList.remove('hidden'); }
  persistProfile();
}

function dismissVideo(videoId) {
  if (!state.feedback[videoId]) state.feedback[videoId] = { clicks: 0, dismissed: false };
  state.feedback[videoId].dismissed = true;
  const card = $(`card-${CSS.escape(videoId)}`);
  if (card) {
    card.style.transition = 'opacity .22s,transform .22s';
    card.style.opacity = '0'; card.style.transform = 'scale(0.9)';
    setTimeout(() => card.remove(), 230);
  }
  persistProfile();
}

function applyFeedback(videos) {
  return videos
    .filter(v => !state.feedback[v.video_id]?.dismissed)
    .map(v => {
      const c = state.feedback[v.video_id]?.clicks || 0;
      return { ...v, score: +Math.min(1, v.score + Math.min(c * 0.03, 0.30)).toFixed(3), clicks: c };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function matchesDurFilter(v, f) {
  const s = v.duration_s || 0;
  if (f === 'all')    return true;
  if (f === 'short')  return s > 0 && s < 900;
  if (f === 'medium') return s >= 900  && s < 1800;
  if (f === 'long')   return s >= 1800 && s < 3600;
  if (f === 'deep')   return s >= 3600;
  return true;
}
function applyFilters(videos) {
  return videos.filter(v => {
    if (!matchesDurFilter(v, state.activeDurFilter)) return false;
    if (state.onlyNew && (state.feedback[v.video_id]?.clicks || 0) > 0) return false;
    return true;
  });
}
function refreshGrid() {
  const filtered = applyFilters(applyFeedback(state.rawVideos));
  $('featured-section').innerHTML = ''; $('featured-section').classList.add('hidden');
  $('videos-grid').innerHTML = '';
  if (!filtered.length) { showEmpty(); return; }
  renderFeatured(filtered[0]);
  renderGrid(filtered.slice(1), true);
}

document.querySelectorAll('.pill:not(.pill--toggle)').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill:not(.pill--toggle)').forEach(b => b.classList.remove('pill--active'));
    btn.classList.add('pill--active');
    state.activeDurFilter = btn.dataset.dur;
    refreshGrid();
  });
});
$('pill-unwatched').addEventListener('click', () => {
  state.onlyNew = !state.onlyNew;
  $('pill-unwatched').classList.toggle('pill--toggle-on', state.onlyNew);
  refreshGrid();
});

// ── Mi Sesión ─────────────────────────────────────────────────────────────────
$('btn-session').addEventListener('click', openSessionModal);
$('btn-close-session').addEventListener('click', () => $('modal-session').classList.add('hidden'));
$('modal-session').addEventListener('click', e => {
  if (e.target === $('modal-session')) $('modal-session').classList.add('hidden');
});
document.querySelectorAll('.time-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-preset').forEach(b => b.classList.remove('time-preset--active'));
    btn.classList.add('time-preset--active');
    state.sessionMinutes = parseInt(btn.dataset.min);
    renderSessionPlaylist();
  });
});

function openSessionModal() {
  $('modal-session').classList.remove('hidden');
  renderSessionPlaylist();
}
function renderSessionPlaylist() {
  const target = state.sessionMinutes * 60;
  const pool   = applyFeedback(state.rawVideos)
    .filter(v => !state.feedback[v.video_id]?.dismissed && (v.duration_s || 0) > 0)
    .sort((a, b) => b.score - a.score);

  const playlist = []; let total = 0;
  for (const v of pool) {
    if (total + (v.duration_s || 0) <= target + 300) {
      playlist.push(v); total += v.duration_s || 0;
      if (total >= target * 0.85) break;
    }
  }

  const emptyEl = $('session-empty'), statsEl = $('session-stats'), listEl = $('session-list');
  if (!playlist.length) {
    emptyEl.classList.remove('hidden'); statsEl.innerHTML = ''; listEl.innerHTML = '';
    $('btn-save-session').disabled = true; return;
  }
  emptyEl.classList.add('hidden');
  $('btn-save-session').disabled = false;

  const totalMin = Math.round(total / 60);
  statsEl.innerHTML = `<span>${playlist.length} videos</span><span>·</span>
    <span>${totalMin} min total</span><span>·</span>
    <span>Score prom: ${(playlist.reduce((s, v) => s + v.score, 0) / playlist.length * 100).toFixed(0)}</span>`;

  listEl.innerHTML = '';
  playlist.forEach((v, i) => {
    const row = document.createElement('a');
    row.className = 'session-item'; row.href = v.url; row.target = '_blank'; row.rel = 'noopener noreferrer';
    row.innerHTML = `
      <span class="session-item-num">${i + 1}</span>
      ${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="" class="session-item-thumb" loading="lazy">` : ''}
      <div class="session-item-info">
        <div class="session-item-title">${esc(v.title)}</div>
        <div class="session-item-meta">${esc(v.channel_title)} · ${fmtDuration(v.duration_s)}</div>
      </div>
      <span class="${scoreBadgeClass(v.score)} score-badge" style="flex-shrink:0;font-size:.7rem">
        ${(v.score * 100).toFixed(0)}</span>`;
    row.addEventListener('click', () => trackClick(v.video_id));
    listEl.appendChild(row);
  });

  $('btn-save-session').onclick = () => {
    const name = prompt('Nombre para esta sesión:', `Sesión ${state.sessionMinutes} min`);
    if (!name?.trim()) return;
    const newList = createList(name.trim());
    playlist.forEach(v => addVideoToList(newList.id, v));
    $('modal-session').classList.add('hidden');
    showToast(`✓ Sesión guardada como "${name.trim()}"`);
  };
}

// ── Keywords ──────────────────────────────────────────────────────────────────
function renderKeywordChips() {
  const container = $('keywords-chips');
  if (!container) return;
  container.innerHTML = '';
  state.keywords.forEach(kw => {
    const chip = document.createElement('span');
    chip.className = 'kw-chip';
    chip.innerHTML = `${esc(kw)}<button class="kw-chip-remove" title="Quitar">×</button>`;
    chip.querySelector('.kw-chip-remove').addEventListener('click', () => {
      state.keywords = state.keywords.filter(k => k !== kw);
      persistProfile();
      renderKeywordChips();
    });
    container.appendChild(chip);
  });
  const badge = $('kw-count-badge');
  if (badge) badge.textContent = `${state.keywords.length} tema${state.keywords.length !== 1 ? 's' : ''}`;
}
function addKeyword(raw) {
  const kw = raw.trim().toLowerCase();
  if (!kw || state.keywords.map(k => k.toLowerCase()).includes(kw)) return false;
  state.keywords.push(kw);
  persistProfile();
  renderKeywordChips();
  return true;
}

function wireKeywordsUI() {
  const input = $('kw-input'), addBtn = $('btn-add-kw');
  if (!input || !addBtn) return;
  const doAdd = () => { if (input.value.trim()) { addKeyword(input.value) && (input.value = ''); } };
  addBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });

  $('btn-suggest-kw').addEventListener('click', async () => {
    const btn = $('btn-suggest-kw'), label = btn.querySelector('.btn-label'), spinner = btn.querySelector('.btn-spinner');
    const errEl = $('kw-error'), wrap = $('kw-suggestions-wrap');
    errEl.classList.add('hidden'); wrap.classList.add('hidden');
    if (!state.keywords.length) { errEl.textContent = 'Agrega al menos un tema primero.'; errEl.classList.remove('hidden'); return; }
    btn.disabled = true; label.textContent = 'Analizando…'; spinner.classList.remove('hidden');
    try {
      const { suggestions } = await apiFetch('/api/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: state.keywords }),
      });
      if (!suggestions.length) { errEl.textContent = 'Sin sugerencias nuevas.'; errEl.classList.remove('hidden'); return; }
      const chips = $('kw-suggestion-chips');
      chips.innerHTML = '';
      suggestions.forEach(kw => {
        const chip = document.createElement('button');
        chip.className = 'kw-chip kw-chip--suggestion'; chip.type = 'button'; chip.textContent = kw;
        chip.addEventListener('click', () => { addKeyword(kw); chip.classList.add('kw-chip--added'); chip.textContent = `✓ ${kw}`; chip.disabled = true; });
        chips.appendChild(chip);
      });
      $('btn-add-all-kw').onclick = () => { suggestions.forEach(kw => addKeyword(kw)); wrap.classList.add('hidden'); showToast(`✓ ${suggestions.length} temas agregados`); };
      wrap.classList.remove('hidden');
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    finally { btn.disabled = false; label.textContent = '💡 Sugerir temas que te faltan'; spinner.classList.add('hidden'); }
  });
}

// ── Score popover ─────────────────────────────────────────────────────────────
const scorePopover = $('score-popover');
let popoverTimer   = null;

function showScorePopover(anchor, breakdown) {
  if (!breakdown) return;
  clearTimeout(popoverTimer);
  const entries = [
    { label: 'Engagement',  val: breakdown.engagement },
    { label: 'Relevancia',  val: breakdown.relevance  },
    { label: 'Profundidad', val: breakdown.depth      },
    { label: 'Duración',    val: breakdown.duration   },
    { label: 'Subtítulos',  val: breakdown.captions   },
    { label: 'Autoridad',   val: breakdown.authority  },
  ];
  scorePopover.innerHTML = `<div class="popover-title">Score breakdown</div>` +
    entries.map(e => `
      <div class="popover-row">
        <span>${e.label}</span>
        <div class="popover-bar-wrap"><div class="popover-bar" style="width:${Math.round(e.val * 100)}%"></div></div>
        <span class="popover-val">${(e.val * 100).toFixed(0)}</span>
      </div>`).join('');

  scorePopover.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const pw   = scorePopover.offsetWidth, ph = scorePopover.offsetHeight;
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 6;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top  + ph > window.scrollY + window.innerHeight - 8) top = rect.top + window.scrollY - ph - 6;
  scorePopover.style.left = `${left}px`;
  scorePopover.style.top  = `${top}px`;
}
function hideScorePopover() { popoverTimer = setTimeout(() => scorePopover.classList.add('hidden'), 150); }
scorePopover.addEventListener('mouseenter', () => clearTimeout(popoverTimer));
scorePopover.addEventListener('mouseleave', hideScorePopover);
window.addEventListener('scroll', () => scorePopover.classList.add('hidden'), { passive: true });

// ── Panel de parámetros ───────────────────────────────────────────────────────
const paramsPanel = $('params-panel');
const btnParams   = $('btn-params');
const weightsSum  = $('weights-sum');

btnParams.addEventListener('click', () => {
  const h = paramsPanel.classList.contains('hidden');
  paramsPanel.classList.toggle('hidden', !h);
  btnParams.setAttribute('aria-expanded', String(h));
  closeListsPanel();
  if (h) {
    const inline = $('profile-desc-inline');
    if (inline && state.description) inline.value = state.description;
    renderKeywordChips();
    $('kw-suggestions-wrap')?.classList.add('hidden');
  }
});
$('btn-close-params').addEventListener('click', () => {
  paramsPanel.classList.add('hidden'); btnParams.setAttribute('aria-expanded', 'false');
});

$('btn-update-profile').addEventListener('click', async () => {
  const btn = $('btn-update-profile'), label = btn.querySelector('.btn-label'), spinner = btn.querySelector('.btn-spinner');
  const errEl = $('profile-inline-error'), okEl = $('profile-inline-ok');
  errEl.classList.add('hidden'); okEl.classList.add('hidden');
  const description = $('profile-desc-inline').value.trim();
  if (description.length < 20) { errEl.textContent = 'Escribe al menos 20 caracteres.'; errEl.classList.remove('hidden'); return; }
  btn.disabled = true; label.textContent = 'Procesando…'; spinner.classList.remove('hidden');
  try {
    const { seeds, keywords } = await apiFetch('/api/onboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    state.description  = description;
    state.derivedSeeds = seeds;
    state.keywords      = keywords;
    persistProfile();
    renderKeywordChips();
    okEl.classList.remove('hidden'); setTimeout(() => okEl.classList.add('hidden'), 3000);
    loadVideos(true);
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  finally { btn.disabled = false; label.textContent = 'Actualizar perfil →'; spinner.classList.add('hidden'); }
});

WEIGHT_KEYS.forEach(key => {
  const s = $(`w-${key}`), o = $(`w-${key}-val`);
  s.addEventListener('input', () => { state.weights[key] = parseInt(s.value); o.textContent = s.value; updateWeightsSum(); });
});
$('dur-min').addEventListener('input', function () { state.durMin = parseInt(this.value); $('dur-min-val').textContent = this.value; });
$('dur-max').addEventListener('input', function () { state.durMax = parseInt(this.value); $('dur-max-val').textContent = this.value; });
$('mode-select').addEventListener('change', function () { state.mode = this.value; applyModePreset(this.value); });

document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    const mode = card.dataset.mode;
    document.querySelectorAll('.mode-card').forEach(c => {
      c.classList.toggle('mode-card--active', c.dataset.mode === mode);
      c.setAttribute('aria-checked', String(c.dataset.mode === mode));
    });
    $('mode-select').value = mode; state.mode = mode; applyModePreset(mode);
  });
});
function syncModeCards(mode) {
  document.querySelectorAll('.mode-card').forEach(c => {
    c.classList.toggle('mode-card--active', c.dataset.mode === mode);
    c.setAttribute('aria-checked', String(c.dataset.mode === mode));
  });
}
function updateWeightsSum() {
  const t = WEIGHT_KEYS.reduce((s, k) => s + state.weights[k], 0);
  weightsSum.textContent = `Σ = ${t}`;
  weightsSum.className   = `badge ${t === 100 ? 'badge--ok' : t > 100 ? 'badge--err' : 'badge--warn'}`;
}
function applyModePreset(mode) {
  const P = {
    depth:    { engagement: 25, relevance: 30, depth: 25, duration: 10, captions: 5, authority:  5 },
    quick:    { engagement: 40, relevance: 20, depth: 10, duration: 20, captions: 5, authority:  5 },
    balanced: { engagement: 35, relevance: 25, depth: 15, duration: 10, captions: 5, authority: 10 },
  };
  Object.assign(state.weights, P[mode] || P.balanced);
  WEIGHT_KEYS.forEach(k => { $(`w-${k}`).value = state.weights[k]; $(`w-${k}-val`).textContent = state.weights[k]; });
  updateWeightsSum();
}

$('btn-apply-params').addEventListener('click', () => {
  persistProfile();
  paramsPanel.classList.add('hidden'); btnParams.setAttribute('aria-expanded', 'false');
  loadVideos(true);
});

// ── Panel de Listas ───────────────────────────────────────────────────────────
const listsPanel  = $('lists-panel');
const listDropdown = $('list-dropdown');

$('btn-lists').addEventListener('click', () => {
  const isHidden = listsPanel.classList.contains('hidden');
  listsPanel.classList.toggle('hidden', !isHidden);
  $('btn-lists').setAttribute('aria-expanded', String(isHidden));
  if (isHidden) { renderListsDirectory(); paramsPanel.classList.add('hidden'); }
});
$('btn-close-lists').addEventListener('click', closeListsPanel);

function closeListsPanel() {
  listsPanel.classList.add('hidden'); $('btn-lists').setAttribute('aria-expanded', 'false');
}
function renderListsBadge() {
  const badge = $('lists-count-badge');
  badge.textContent = state.lists.length;
  badge.classList.toggle('hidden', state.lists.length === 0);
}
function renderListsDirectory() {
  const dir = $('lists-directory'); dir.innerHTML = '';
  if (!state.lists.length) {
    dir.innerHTML = '<p class="lists-empty-hint">Sin listas aún.<br>Crea una con el botón de arriba.</p>'; return;
  }
  [...state.lists].sort((a, b) => a.order - b.order).forEach(list => {
    const count = Object.keys(state.listItems[list.id] || {}).length;
    const btn   = document.createElement('button');
    btn.className = 'list-dir-item'; btn.type = 'button';
    btn.innerHTML = `<span class="list-dir-name">${esc(list.name)}</span><span class="list-dir-count">${count} video${count !== 1 ? 's' : ''}</span>`;
    btn.addEventListener('click', () => { closeListsPanel(); showListView(list.id); });
    dir.appendChild(btn);
  });
}
$('btn-create-list').addEventListener('click', () => {
  const name = prompt('Nombre de la nueva lista:', '');
  if (name?.trim()) createList(name.trim());
});

function createList(name) {
  const newList = { id: uid(), name, order: state.lists.length, created_at: new Date().toISOString() };
  state.lists.push(newList); state.listItems[newList.id] = {};
  persistLists(); renderListsBadge(); renderListsDirectory();
  showToast(`Lista "${name}" creada`); return newList;
}
function deleteList(listId) {
  if (!confirm('¿Eliminar esta lista?')) return;
  state.lists = state.lists.filter(l => l.id !== listId); delete state.listItems[listId];
  persistLists(); renderListsBadge(); showHomeView(); showToast('Lista eliminada');
}
function renameList(listId) {
  const list = state.lists.find(l => l.id === listId); if (!list) return;
  const name = prompt('Nuevo nombre:', list.name);
  if (!name?.trim() || name.trim() === list.name) return;
  list.name = name.trim(); persistLists(); $('list-view-name').textContent = list.name; showToast('Lista renombrada');
}
function persistLists() { persistProfile(); }

// ── Vista de Lista ────────────────────────────────────────────────────────────
function showListView(listId) {
  const list = state.lists.find(l => l.id === listId); if (!list) return;
  state.currentView = 'list'; state.currentListId = listId;
  $('home-view').classList.add('hidden'); $('list-view').classList.remove('hidden');
  $('list-view-name').textContent = list.name; renderListView();
}
function showHomeView() {
  state.currentView = 'home'; state.currentListId = null;
  $('list-view').classList.add('hidden'); $('home-view').classList.remove('hidden');
}
$('btn-back-home').addEventListener('click', showHomeView);
$('btn-delete-list').addEventListener('click', () => { if (state.currentListId) deleteList(state.currentListId); });
$('btn-rename-list').addEventListener('click', () => { if (state.currentListId) renameList(state.currentListId); });

function renderListView() {
  const container = $('list-items-container'); container.innerHTML = '';
  const items  = state.listItems[state.currentListId] || {};
  const sorted = Object.entries(items).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  $('list-empty-state').classList.toggle('hidden', sorted.length > 0);
  sorted.forEach(([videoId, data], idx) => container.appendChild(buildListItemRow(videoId, data, idx, sorted.length)));
}
function buildListItemRow(videoId, data, idx, total) {
  const card = document.createElement('div');
  card.className = 'list-card'; card.id = `listrow-${CSS.escape(videoId)}`; card.dataset.order = String(idx);

  const hasReason = data.reason && data.reason.length > 5;

  card.innerHTML = `
    <a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer" class="list-card-thumb-link">
      ${data.thumbnail_url
        ? `<img src="${esc(data.thumbnail_url)}" alt="${esc(data.title)}" class="list-card-thumb" loading="lazy">`
        : `<div class="list-card-thumb-placeholder">▶</div>`}
      <span class="list-card-duration">${fmtDuration(data.duration_s)}</span>
      <span class="list-card-play-overlay">▶</span>
    </a>

    <div class="list-card-body">
      <div class="list-card-num">${idx + 1}</div>

      <div class="list-card-content">
        <a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer" class="list-card-title">
          ${esc(data.title)}
        </a>
        <div class="list-card-meta">
          <span class="list-card-channel">${esc(data.channel_title)}</span>
          ${data.score ? `<span class="${scoreBadgeClass(data.score)} score-badge" style="font-size:.68rem">Score ${(data.score * 100).toFixed(0)}</span>` : ''}
        </div>

        <p id="reason-${CSS.escape(videoId)}" class="list-card-reason${hasReason ? '' : ' hidden'}">
          ${hasReason ? esc(data.reason) : ''}
        </p>
      </div>

      <div class="list-card-actions">
        <button class="btn-move" data-dir="up"   title="Subir"  ${idx === 0         ? 'disabled' : ''}>↑</button>
        <button class="btn-move" data-dir="down" title="Bajar"  ${idx === total - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn-remove-from-list" title="Quitar de la lista">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`;

  card.querySelectorAll('.btn-move').forEach(btn =>
    btn.addEventListener('click', () => moveItemInList(state.currentListId, videoId, btn.dataset.dir)));
  card.querySelector('.btn-remove-from-list').addEventListener('click', () => removeFromList(state.currentListId, videoId));
  return card;
}
function moveItemInList(listId, videoId, dir) {
  const items  = state.listItems[listId]; if (!items) return;
  const sorted = Object.entries(items).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const idx    = sorted.findIndex(([id]) => id === videoId);
  const swap   = dir === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= sorted.length) return;
  [sorted[idx][1].order, sorted[swap][1].order] = [sorted[swap][1].order, sorted[idx][1].order];
  persistLists(); renderListView();
}
function removeFromList(listId, videoId) {
  delete state.listItems[listId][videoId]; persistLists();
  const card = $(`listrow-${CSS.escape(videoId)}`);
  if (card) {
    card.style.transition = 'opacity .2s, transform .2s';
    card.style.opacity = '0'; card.style.transform = 'scale(0.97)';
    setTimeout(() => card.remove(), 220);
  }
  const remaining = Object.keys(state.listItems[listId] || {}).length;
  $('list-empty-state').classList.toggle('hidden', remaining > 0);
  showToast('Video quitado de la lista');
}
async function addVideoToList(listId, videoData) {
  const items = state.listItems[listId] || {};
  if (items[videoData.video_id]) { showToast('Ya está en esta lista'); return; }

  items[videoData.video_id] = {
    order:         Object.keys(items).length,
    added_at:      new Date().toISOString(),
    title:         videoData.title,
    channel_title: videoData.channel_title,
    thumbnail_url: videoData.thumbnail_url,
    url:           videoData.url,
    duration_s:    videoData.duration_s || videoData.duration_seconds,
    score:         videoData.score || 0,
    breakdown:     videoData.breakdown || null,
    reason:        '',
  };
  state.listItems[listId] = items;
  persistLists();

  const listName = state.lists.find(l => l.id === listId)?.name || 'lista';
  showToast(`✓ Guardado en "${listName}"`);
  markCardAsSaved(videoData.video_id);
  if (state.currentView === 'list' && state.currentListId === listId) renderListView();

  // Genera razón en background y actualiza sin bloquear
  try {
    const { reason } = await apiFetch('/api/recommend-reason', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:         videoData.title,
        channel_title: videoData.channel_title,
        duration_s:    videoData.duration_s || videoData.duration_seconds || 0,
        breakdown:     videoData.breakdown || {},
        keywords:      state.keywords,
      }),
    });
    if (reason && state.listItems[listId]?.[videoData.video_id]) {
      state.listItems[listId][videoData.video_id].reason = reason;
      persistLists();
      const reasonEl = $(`reason-${CSS.escape(videoData.video_id)}`);
      if (reasonEl) {
        reasonEl.textContent = reason;
        reasonEl.classList.remove('hidden');
      }
    }
  } catch { /* razón es opcional, no falla la acción */ }
}

function markCardAsSaved(videoId) {
  const card = $(`card-${CSS.escape(videoId)}`);
  if (!card) return;
  // Pulso en el borde de la tarjeta
  card.classList.add('card--just-saved');
  setTimeout(() => card.classList.remove('card--just-saved'), 900);
  // Ícono del bookmark cambia a ✓ guardado
  const btn = card.querySelector('.btn-bookmark');
  if (!btn) return;
  btn.classList.add('btn-bookmark--saved');
  btn.title = 'Guardado en lista';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
}

// ── Dropdown "Agregar a lista" ────────────────────────────────────────────────
let _dropdownVideoData = null;

function showListDropdown(anchor, videoData) {
  _dropdownVideoData = videoData;
  const items = $('list-dropdown-items'); items.innerHTML = '';
  if (!state.lists.length) {
    items.innerHTML = '<p style="padding:.5rem .75rem;color:var(--text-muted);font-size:.8rem">Sin listas aún</p>';
  } else {
    state.lists.forEach(list => {
      const inList = !!state.listItems[list.id]?.[videoData.video_id];
      const btn    = document.createElement('button');
      btn.className = `list-dropdown-item${inList ? ' list-dropdown-item--saved' : ''}`;
      btn.type = 'button'; btn.textContent = inList ? `✓ ${list.name}` : list.name;
      btn.addEventListener('click', () => { if (!inList) addVideoToList(list.id, videoData); closeDropdown(); });
      items.appendChild(btn);
    });
  }
  const rect = anchor.getBoundingClientRect();
  listDropdown.classList.remove('hidden');
  listDropdown.style.top  = `${rect.bottom + window.scrollY + 4}px`;
  listDropdown.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 220)}px`;
}
function closeDropdown() { listDropdown.classList.add('hidden'); _dropdownVideoData = null; }

$('list-dropdown-new').addEventListener('click', () => {
  closeDropdown();
  const name = prompt('Nombre de la nueva lista:', '');
  if (!name?.trim()) return;
  const newList = createList(name.trim());
  if (_dropdownVideoData) { addVideoToList(newList.id, _dropdownVideoData); _dropdownVideoData = null; }
});
document.addEventListener('click', e => {
  if (!listDropdown.classList.contains('hidden') && !listDropdown.contains(e.target) && !e.target.closest('.btn-bookmark'))
    closeDropdown();
});

// ── Modal: Agregar video por URL ──────────────────────────────────────────────
function openAddVideoModal(preselectedListId = null) {
  state.pendingAddVideoListId = preselectedListId;
  $('video-url-input').value = '';
  $('video-preview').classList.add('hidden'); $('video-preview').innerHTML = '';
  $('modal-list-select-wrap').classList.add('hidden');
  $('modal-error').classList.add('hidden');
  $('modal-add-video').classList.remove('hidden');
  $('video-url-input').focus();
  populateModalListSelect(preselectedListId);
}
function closeModal() { $('modal-add-video').classList.add('hidden'); }

function populateModalListSelect(preselected) {
  const sel = $('modal-list-select'); sel.innerHTML = '';
  state.lists.forEach(list => {
    const opt = document.createElement('option');
    opt.value = list.id; opt.textContent = list.name;
    if (list.id === preselected) opt.selected = true;
    sel.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__'; newOpt.textContent = '+ Nueva lista…';
  sel.appendChild(newOpt);
}

$('btn-close-modal').addEventListener('click', closeModal);
$('modal-add-video').addEventListener('click', e => { if (e.target === $('modal-add-video')) closeModal(); });
$('btn-open-add-video-bar').addEventListener('click',  () => openAddVideoModal(null));
$('btn-open-add-video-list').addEventListener('click', () => openAddVideoModal(state.currentListId));

$('btn-fetch-video').addEventListener('click', async () => {
  const btn = $('btn-fetch-video'), label = btn.querySelector('.btn-label'), spinner = btn.querySelector('.btn-spinner');
  const url = $('video-url-input').value.trim(), errEl = $('modal-error');
  errEl.classList.add('hidden');
  if (!url) { errEl.textContent = 'Pega una URL de YouTube primero.'; errEl.classList.remove('hidden'); return; }
  btn.disabled = true; label.textContent = 'Buscando…'; spinner.classList.remove('hidden');
  try {
    const { video } = await apiFetch('/api/add-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const preview = $('video-preview');
    preview.innerHTML = `<div class="modal-preview">
      ${video.thumbnail_url ? `<img src="${esc(video.thumbnail_url)}" alt="" class="modal-preview-thumb">` : ''}
      <div><div class="modal-preview-title">${esc(video.title)}</div>
      <div class="modal-preview-meta">${esc(video.channel_title)} · ${fmtDuration(video.duration_s)}</div></div></div>`;
    preview.classList.remove('hidden');
    btn.dataset.videoData = JSON.stringify(video);
    $('modal-list-select-wrap').classList.remove('hidden');
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  finally { btn.disabled = false; label.textContent = 'Buscar video'; spinner.classList.add('hidden'); }
});

$('btn-confirm-add-video').addEventListener('click', async () => {
  const videoData = JSON.parse($('btn-fetch-video').dataset.videoData || 'null');
  if (!videoData) { $('modal-error').textContent = 'Primero busca un video.'; $('modal-error').classList.remove('hidden'); return; }
  let listId = $('modal-list-select').value;
  if (listId === '__new__') {
    const name = prompt('Nombre de la nueva lista:', ''); if (!name?.trim()) return;
    listId = createList(name.trim()).id; populateModalListSelect(listId);
  }
  addVideoToList(listId, videoData); closeModal();
});

// ── Cargar videos ─────────────────────────────────────────────────────────────
async function loadVideos(reset = false) {
  if (state.loading) return;
  state.loading = true;
  if (reset) {
    state.rawVideos = []; state.offset = 0; state.hasMore = false;
    $('videos-grid').innerHTML = '';
    $('featured-section').innerHTML = ''; $('featured-section').classList.add('hidden');
    $('filter-bar').classList.add('hidden');
  }
  showLoading(true); hideStates();
  try {
    const params = new URLSearchParams({
      offset: String(state.offset), limit: '20',
      weights: JSON.stringify(state.weights), keywords: JSON.stringify(state.keywords),
    });
    const { videos, total, hasMore } = await apiFetch(`/api/videos?${params}`);
    state.hasMore = hasMore; state.offset += videos.length;
    state.rawVideos.push(...videos);
    const adjusted = applyFeedback(videos);
    if (reset && total === 0) { showEmpty(); return; }
    if (reset && adjusted.length > 0) { renderFeatured(adjusted[0]); renderGrid(adjusted.slice(1), true); }
    else renderGrid(adjusted, false);
    $('load-more-area').classList.toggle('hidden', !hasMore);
    if (state.rawVideos.length > 0) $('filter-bar').classList.remove('hidden');
  } catch (err) { showError(err.message); }
  finally { state.loading = false; showLoading(false); }
}
$('btn-load-more').addEventListener('click', () => loadVideos(false));
$('btn-retry').addEventListener('click', () => loadVideos(true));

// ── Renderizar ────────────────────────────────────────────────────────────────
function renderFeatured(v) {
  const sec = $('featured-section'); sec.innerHTML = '';
  sec.appendChild(buildFeaturedCard(v)); sec.classList.remove('hidden');
}
function renderGrid(videos, reset) {
  const grid = $('videos-grid'); if (reset) grid.innerHTML = '';
  videos.forEach(v => grid.appendChild(buildVideoCard(v)));
}
function buildFeaturedCard(v) {
  const a = document.createElement('a');
  a.className = 'featured-card'; a.href = v.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.id = `card-${v.video_id}`; a.setAttribute('role', 'listitem');
  a.innerHTML = `
    <span class="featured-badge">🏆 Joya #1</span>
    ${v.thumbnail_url ? `<img class="featured-thumb" src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : `<div class="featured-thumb video-thumb-placeholder">▶</div>`}
    <div class="featured-info">
      <div class="video-title">${esc(v.title)}</div>
      <div class="video-meta"><span class="video-channel">${esc(v.channel_title)}</span><span>${fmtViews(v.view_count)} vistas</span><span>${fmtDuration(v.duration_s)}</span></div>
      <div class="video-score-row" style="margin-top:.75rem">
        <span class="${scoreBadgeClass(v.score)} score-badge score-badge--clickable" data-video-id="${v.video_id}">Score ${(v.score * 100).toFixed(0)}</span>
        ${v.breakdown?.captions ? '<span class="captions-badge">CC</span>' : ''}
        <span class="clicks-badge${(v.clicks||0)===0?' hidden':''}" id="clk-${v.video_id}">${v.clicks||0} clic${(v.clicks||0)!==1?'s':''}</span>
      </div>
    </div>`;
  a.appendChild(buildDismissBtn(v.video_id));
  a.appendChild(buildBookmarkBtn(v));
  a.addEventListener('click', e => {
    if (e.target.closest('.btn-dismiss,.btn-bookmark')) return;
    if (e.target.closest('.score-badge--clickable')) { e.preventDefault(); return; }
    trackClick(v.video_id);
  });
  wireScorebadge(a, v); return a;
}
function buildVideoCard(v) {
  const a = document.createElement('a');
  a.className = 'video-card'; a.href = v.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.id = `card-${v.video_id}`; a.setAttribute('role', 'listitem');
  a.innerHTML = `
    <div class="video-thumb-wrap">
      ${v.thumbnail_url ? `<img class="video-thumb" src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">` : `<div class="video-thumb-placeholder">▶</div>`}
      <span class="video-duration">${fmtDuration(v.duration_s)}</span>
    </div>
    <div class="video-info">
      <div class="video-title">${esc(v.title)}</div>
      <div class="video-meta"><span class="video-channel">${esc(v.channel_title)}</span><span>${fmtViews(v.view_count)}</span></div>
      <div class="video-score-row">
        <span class="${scoreBadgeClass(v.score)} score-badge score-badge--clickable">Score ${(v.score * 100).toFixed(0)}</span>
        <span class="clicks-badge${(v.clicks||0)===0?' hidden':''}" id="clk-${v.video_id}">${v.clicks||0} clic${(v.clicks||0)!==1?'s':''}</span>
        ${v.breakdown?.captions ? '<span class="captions-badge">CC</span>' : ''}
      </div>
    </div>`;
  a.appendChild(buildDismissBtn(v.video_id));
  a.appendChild(buildBookmarkBtn(v));
  a.addEventListener('click', e => {
    if (e.target.closest('.btn-dismiss,.btn-bookmark')) return;
    if (e.target.closest('.score-badge--clickable')) { e.preventDefault(); return; }
    trackClick(v.video_id);
  });
  wireScorebadge(a, v); return a;
}
function wireScorebadge(cardEl, v) {
  if (!v.breakdown) return;
  const badge = cardEl.querySelector('.score-badge--clickable'); if (!badge) return;
  badge.addEventListener('mouseenter', () => showScorePopover(badge, v.breakdown));
  badge.addEventListener('mouseleave', hideScorePopover);
  badge.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    scorePopover.classList.contains('hidden') ? showScorePopover(badge, v.breakdown) : scorePopover.classList.add('hidden');
  });
}
function buildDismissBtn(videoId) {
  const btn = document.createElement('button');
  btn.className = 'btn-dismiss'; btn.title = 'No me interesa'; btn.type = 'button'; btn.innerHTML = '×';
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); dismissVideo(videoId); });
  return btn;
}
function buildBookmarkBtn(videoData) {
  const btn = document.createElement('button');
  btn.className = 'btn-bookmark'; btn.title = 'Guardar en lista'; btn.type = 'button';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (!state.lists.length) { const name = prompt('Nombre de la nueva lista:', ''); if (name?.trim()) createList(name.trim()); return; }
    showListDropdown(btn, videoData);
  });
  return btn;
}

// ── Estado UI ─────────────────────────────────────────────────────────────────
function showLoading(show) { $('loading').classList.toggle('hidden', !show); }
function hideStates() { $('empty-state').classList.add('hidden'); $('error-state').classList.add('hidden'); $('load-more-area').classList.add('hidden'); }
function showEmpty()    { $('empty-state').classList.remove('hidden'); }
function showError(msg) { $('error-state-msg').textContent = msg; $('error-state').classList.remove('hidden'); }

// ── Aplicar perfil al estado ──────────────────────────────────────────────────
function applyProfileToState(p) {
  if (!p) return;
  if (p.description)  state.description  = p.description;
  if (p.derived_seeds) state.derivedSeeds = p.derived_seeds;
  if (p.interest_keywords?.length) { state.keywords = p.interest_keywords; renderKeywordChips(); }
  if (p.feedback)   state.feedback   = p.feedback;
  if (p.lists)      state.lists      = p.lists;
  if (p.listItems)  state.listItems  = p.listItems;
  state.lists.forEach(l => { if (!state.listItems[l.id]) state.listItems[l.id] = {}; });
  if (p.weights) {
    Object.assign(state.weights, p.weights);
    WEIGHT_KEYS.forEach(k => {
      const s = $(`w-${k}`), o = $(`w-${k}-val`);
      if (s && state.weights[k] !== undefined) { s.value = state.weights[k]; o.textContent = state.weights[k]; }
    });
    updateWeightsSum();
  }
  if (p.settings) {
    const s = p.settings;
    if (s.mode)         { state.mode = s.mode; $('mode-select').value = s.mode; syncModeCards(s.mode); }
    if (s.duration_min) { state.durMin = s.duration_min; $('dur-min').value = s.duration_min; $('dur-min-val').textContent = s.duration_min; }
    if (s.duration_max) { state.durMax = s.duration_max; $('dur-max').value = s.duration_max; $('dur-max-val').textContent = s.duration_max; }
  }
}

// ── Inicio: sin auth, perfil sincronizado vía /api/profile (KV) ───────────────
updateWeightsSum();
wireKeywordsUI();

(async function init() {
  const storedProfile = await fetchProfile();
  if (storedProfile?.interest_keywords?.length) {
    applyProfileToState(storedProfile);
    showScreen('screen-app');
    renderListsBadge();
    loadVideos(true);
    startSyncLoop();
  } else {
    showScreen('screen-onboard');
  }
  logger.info('App lista · sin auth · tiempo real · v2.3');
})();
