/**
 * app.js – Lógica principal del frontend.
 * Importa desde firebase-config.js (SDK de Firebase via CDN).
 * Vanilla JS, no bundler.
 */

import {
  auth, db, googleProvider,
  signInWithPopup, onAuthStateChanged, signOut,
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from './firebase-config.js';

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  user:        null,    // firebase.User
  idToken:     null,    // JWT string (se refresca en cada llamada)
  userProfile: null,    // doc Firestore users/{uid}
  videos:      [],      // videos ya cargados
  offset:      0,
  hasMore:     false,
  loading:     false,
  weights: {
    engagement: 35, relevance: 25, depth: 15,
    duration: 10, captions: 5, authority: 10,
  },
  keywords: [],
  durMin: 8,   // minutos
  durMax: 60,
  mode: 'balanced',
};

// ── Pantallas ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Firebase Auth ─────────────────────────────────────────────────────────────
document.getElementById('btn-google-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-google-login');
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  btn.disabled = true;
  try {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged maneja la transición
  } catch (err) {
    errEl.textContent = `Error al iniciar sesión: ${err.message}`;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user) {
    state.userProfile = null;
    state.idToken     = null;
    showScreen('screen-login');
    return;
  }

  try {
    state.idToken = await user.getIdToken();

    // Intentar leer perfil de Firestore
    // Si las reglas no están desplegadas aún o Firestore falla,
    // tratamos al usuario como nuevo y mostramos onboarding.
    let snap = null;
    try {
      const profileRef = doc(db, 'users', user.uid);
      snap = await getDoc(profileRef);
    } catch (firestoreErr) {
      console.warn('Firestore no disponible, mostrando onboarding:', firestoreErr.message);
      showScreen('screen-onboard');
      return;
    }

    if (!snap.exists() || !snap.data()?.interest_keywords?.length) {
      showScreen('screen-onboard');
    } else {
      state.userProfile = snap.data();
      applyProfileToState(state.userProfile);
      showScreen('screen-app');
      loadVideos(true);
    }
  } catch (err) {
    // Fallback: si algo falla inesperadamente, regresar a login con mensaje
    console.error('Error en onAuthStateChanged:', err);
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.textContent = `Error al cargar tu sesión: ${err.message}`;
      errEl.classList.remove('hidden');
    }
    await signOut(auth).catch(() => {});
  }
});

// ── Refresco de token (llama antes de cada request) ───────────────────────────
async function getToken() {
  if (!state.user) throw new Error('No hay usuario autenticado');
  state.idToken = await state.user.getIdToken(/* forceRefresh */ false);
  return state.idToken;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const descInput = document.getElementById('description-input');
const charCount  = document.getElementById('char-count');

descInput.addEventListener('input', () => {
  charCount.textContent = descInput.value.length;
});

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-save-profile');
  const errEl  = document.getElementById('onboard-error');
  const label  = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.btn-spinner');

  errEl.classList.add('hidden');
  const description = descInput.value.trim();
  if (description.length < 20) {
    errEl.textContent = 'Por favor escribe al menos 20 caracteres.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  label.textContent = 'Procesando…';
  spinner.classList.remove('hidden');

  try {
    const token = await getToken();
    const res = await fetch('/api/onboard', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ description }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || `Error ${res.status}`);
    }

    const { seeds, keywords } = await res.json();

    // Guardar en Firestore (tolerante a fallos de permisos)
    const profileRef = doc(db, 'users', state.user.uid);
    const profileData = {
      description,
      derived_seeds:     seeds,
      interest_keywords: keywords,
      weights: { ...state.weights },
      settings: { mode: state.mode, duration_min: state.durMin, duration_max: state.durMax },
      updated_at: serverTimestamp(),
    };
    try {
      await setDoc(profileRef, profileData, { merge: true });
    } catch (fsErr) {
      // Si Firestore rechaza (reglas en producción aún no desplegadas),
      // continuamos de todas formas — el perfil se guardará en sesión
      console.warn('Firestore write falló (reglas pendientes):', fsErr.message);
    }

    state.userProfile = profileData;
    state.keywords = keywords;

    showScreen('screen-app');
    loadVideos(true);

  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    label.textContent = 'Generar mi perfil →';
    spinner.classList.add('hidden');
  }
});

// ── Panel de parámetros ───────────────────────────────────────────────────────
const paramsPanel = document.getElementById('params-panel');
const btnParams   = document.getElementById('btn-params');
const weightsSum  = document.getElementById('weights-sum');

btnParams.addEventListener('click', () => {
  const isHidden = paramsPanel.classList.contains('hidden');
  paramsPanel.classList.toggle('hidden', !isHidden);
  btnParams.setAttribute('aria-expanded', String(isHidden));
});

document.getElementById('btn-close-params').addEventListener('click', () => {
  paramsPanel.classList.add('hidden');
  btnParams.setAttribute('aria-expanded', 'false');
});

// Sliders de pesos
const WEIGHT_KEYS = ['engagement', 'relevance', 'depth', 'duration', 'captions', 'authority'];

WEIGHT_KEYS.forEach(key => {
  const slider = document.getElementById(`w-${key}`);
  const output = document.getElementById(`w-${key}-val`);
  slider.addEventListener('input', () => {
    state.weights[key] = parseInt(slider.value);
    output.textContent = slider.value;
    updateWeightsSum();
  });
});

// Sliders de duración
document.getElementById('dur-min').addEventListener('input', function () {
  state.durMin = parseInt(this.value);
  document.getElementById('dur-min-val').textContent = this.value;
});
document.getElementById('dur-max').addEventListener('input', function () {
  state.durMax = parseInt(this.value);
  document.getElementById('dur-max-val').textContent = this.value;
});

// Selector de modo
document.getElementById('mode-select').addEventListener('change', function () {
  state.mode = this.value;
  applyModePreset(this.value);
});

function updateWeightsSum() {
  const total = WEIGHT_KEYS.reduce((s, k) => s + state.weights[k], 0);
  weightsSum.textContent = `Σ = ${total}`;
  weightsSum.className   = 'badge ' + (total === 100 ? 'badge--ok' : total > 100 ? 'badge--err' : 'badge--warn');
}

function applyModePreset(mode) {
  const presets = {
    depth:   { engagement: 25, relevance: 30, depth: 25, duration: 10, captions: 5, authority: 5 },
    quick:   { engagement: 40, relevance: 20, depth: 10, duration: 20, captions: 5, authority: 5 },
    balanced: { engagement: 35, relevance: 25, depth: 15, duration: 10, captions: 5, authority: 10 },
  };
  const preset = presets[mode] || presets.balanced;
  Object.assign(state.weights, preset);
  WEIGHT_KEYS.forEach(key => {
    document.getElementById(`w-${key}`).value = state.weights[key];
    document.getElementById(`w-${key}-val`).textContent = state.weights[key];
  });
  updateWeightsSum();
}

document.getElementById('btn-apply-params').addEventListener('click', async () => {
  // Persistir en Firestore
  if (state.user) {
    const profileRef = doc(db, 'users', state.user.uid);
    await updateDoc(profileRef, {
      weights:  { ...state.weights },
      settings: { mode: state.mode, duration_min: state.durMin, duration_max: state.durMax },
      updated_at: serverTimestamp(),
    }).catch(e => console.warn('updateDoc falló:', e.message)); // no bloquear si falla
  }
  paramsPanel.classList.add('hidden');
  btnParams.setAttribute('aria-expanded', 'false');
  loadVideos(true);
});

document.getElementById('btn-edit-profile').addEventListener('click', () => {
  paramsPanel.classList.add('hidden');
  showScreen('screen-onboard');
  if (state.userProfile?.description) {
    descInput.value = state.userProfile.description;
    charCount.textContent = descInput.value.length;
  }
});

// ── Cargar videos ─────────────────────────────────────────────────────────────
async function loadVideos(reset = false) {
  if (state.loading) return;
  state.loading = true;

  if (reset) {
    state.videos  = [];
    state.offset  = 0;
    state.hasMore = false;
    document.getElementById('videos-grid').innerHTML   = '';
    document.getElementById('featured-section').innerHTML = '';
    document.getElementById('featured-section').classList.add('hidden');
  }

  showLoading(true);
  hideStates();

  try {
    const token = await getToken();

    const params = new URLSearchParams({
      offset:   String(state.offset),
      limit:    '20',
      weights:  JSON.stringify(state.weights),
      keywords: JSON.stringify(state.keywords),
    });

    const res = await fetch(`/api/videos?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 401) { await signOut(auth); return; }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status}`);
    }

    const { videos, total, hasMore } = await res.json();

    state.hasMore = hasMore;
    state.offset += videos.length;

    if (reset && total === 0) {
      showEmpty();
      return;
    }

    if (reset && videos.length > 0) {
      renderFeatured(videos[0]);
      renderGrid(videos.slice(1), true);
    } else {
      renderGrid(videos, false);
    }

    document.getElementById('load-more-area').classList.toggle('hidden', !hasMore);

  } catch (err) {
    showError(err.message);
  } finally {
    state.loading = false;
    showLoading(false);
  }
}

document.getElementById('btn-load-more').addEventListener('click', () => loadVideos(false));
document.getElementById('btn-retry').addEventListener('click', () => loadVideos(true));

// ── Renderizar ────────────────────────────────────────────────────────────────

function renderFeatured(video) {
  const sec = document.getElementById('featured-section');
  sec.innerHTML = '';
  sec.appendChild(buildFeaturedCard(video));
  sec.classList.remove('hidden');
}

function renderGrid(videos, reset) {
  const grid = document.getElementById('videos-grid');
  if (reset) grid.innerHTML = '';
  videos.forEach(v => grid.appendChild(buildVideoCard(v)));
}

function buildFeaturedCard(v) {
  const a = document.createElement('a');
  a.className = 'featured-card';
  a.href = v.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute('role', 'listitem');

  a.innerHTML = `
    <span class="featured-badge">🏆 Joya #1</span>
    ${v.thumbnail_url
      ? `<img class="featured-thumb" src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">`
      : `<div class="featured-thumb video-thumb-placeholder">▶</div>`
    }
    <div class="featured-info">
      <div class="video-title">${esc(v.title)}</div>
      <div class="video-meta">
        <span class="video-channel">${esc(v.channel_title)}</span>
        <span class="video-views">${fmtViews(v.view_count)} vistas</span>
        <span>${fmtDuration(v.duration_s)}</span>
      </div>
      <div class="video-score-row" style="margin-top:.75rem">
        <span class="${scoreBadgeClass(v.score)} score-badge">Score ${(v.score * 100).toFixed(0)}</span>
        ${v.breakdown?.captions ? '<span class="captions-badge">CC</span>' : ''}
      </div>
    </div>`;
  return a;
}

function buildVideoCard(v) {
  const a = document.createElement('a');
  a.className = 'video-card';
  a.href = v.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute('role', 'listitem');

  a.innerHTML = `
    <div class="video-thumb-wrap">
      ${v.thumbnail_url
        ? `<img class="video-thumb" src="${esc(v.thumbnail_url)}" alt="${esc(v.title)}" loading="lazy">`
        : `<div class="video-thumb-placeholder">▶</div>`
      }
      <span class="video-duration">${fmtDuration(v.duration_s)}</span>
    </div>
    <div class="video-info">
      <div class="video-title">${esc(v.title)}</div>
      <div class="video-meta">
        <span class="video-channel">${esc(v.channel_title)}</span>
        <span class="video-views">${fmtViews(v.view_count)}</span>
      </div>
      <div class="video-score-row">
        <span class="${scoreBadgeClass(v.score)} score-badge">Score ${(v.score * 100).toFixed(0)}</span>
        ${v.breakdown?.captions ? '<span class="captions-badge">CC</span>' : ''}
      </div>
    </div>`;
  return a;
}

// ── Estado UI helpers ─────────────────────────────────────────────────────────

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function hideStates() {
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('load-more-area').classList.add('hidden');
}

function showEmpty() {
  document.getElementById('empty-state').classList.remove('hidden');
}

function showError(msg) {
  const el = document.getElementById('error-state');
  document.getElementById('error-state-msg').textContent = msg;
  el.classList.remove('hidden');
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDuration(seconds) {
  if (!seconds) return '?';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function fmtViews(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function scoreBadgeClass(score) {
  if (score >= 0.6) return 'score-hi';
  if (score >= 0.35) return 'score-mid';
  return 'score-lo';
}

function pad(n) { return String(n).padStart(2, '0'); }
function esc(str) { return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

// ── Aplicar perfil guardado al estado ─────────────────────────────────────────
function applyProfileToState(profile) {
  if (profile.interest_keywords?.length) {
    state.keywords = profile.interest_keywords;
  }
  if (profile.weights) {
    Object.assign(state.weights, profile.weights);
    WEIGHT_KEYS.forEach(key => {
      const slider = document.getElementById(`w-${key}`);
      const output = document.getElementById(`w-${key}-val`);
      if (slider && state.weights[key] !== undefined) {
        slider.value = state.weights[key];
        output.textContent = state.weights[key];
      }
    });
    updateWeightsSum();
  }
  if (profile.settings) {
    const s = profile.settings;
    if (s.mode)         { state.mode = s.mode; document.getElementById('mode-select').value = s.mode; }
    if (s.duration_min) { state.durMin = s.duration_min; document.getElementById('dur-min').value = s.duration_min; document.getElementById('dur-min-val').textContent = s.duration_min; }
    if (s.duration_max) { state.durMax = s.duration_max; document.getElementById('dur-max').value = s.duration_max; document.getElementById('dur-max-val').textContent = s.duration_max; }
  }
}

// Inicializar suma de pesos
updateWeightsSum();
