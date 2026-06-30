// app.js — logica del front (vanilla JS, mobile-first).

const LS_PW = "yt_tops_app_password";
const state = {
  mode: "joyas",
  offset: 0,
  limit: 20,
  total: 0,
  loading: false,
  done: false,
  settings: null,
  savedIds: new Set(),
};

// ---------- API ----------
function authHeaders(extra = {}) {
  const pw = localStorage.getItem(LS_PW);
  return pw ? { "x-app-password": pw, ...extra } : { ...extra };
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: authHeaders(opts.body ? { "content-type": "application/json" } : {}),
  });
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.auth_required) {
      const pw = window.prompt("Esta app pide contraseña:");
      if (pw) {
        localStorage.setItem(LS_PW, pw);
        return api(path, opts); // reintenta
      }
    }
    throw new Error("No autorizado");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- Helpers ----------
function fmtDur(s) {
  s = s || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtViews(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) e.append(c);
  return e;
}

// ---------- Render tarjetas ----------
function cardEl(v, featured = false) {
  const saved = state.savedIds.has(v.video_id);
  const thumb = el("div", { class: "thumb-wrap" }, [
    featured ? el("span", { class: "badge-gem", html: "★ Joya #1" }) : null,
    el("img", {
      loading: "lazy",
      src: v.thumbnail_url || "",
      alt: v.title || "",
      onerror: function () { this.style.visibility = "hidden"; },
    }),
    el("span", { class: "score-badge", html: `${v.score}` }),
    el("span", { class: "dur-badge", html: fmtDur(v.duration_seconds) }),
  ]);

  const actions = el("div", { class: "card-actions" }, [
    el("a", { class: "watch", href: v.url, target: "_blank", rel: "noopener", html: "▶ Ver" }),
    el("button", {
      class: "save" + (saved ? " is-saved" : ""),
      title: "Guardar para ver después",
      html: saved ? "★ Guardado" : "★ Guardar",
      onclick: (e) => toggleSave(v, e.currentTarget),
    }),
    el("button", { class: "why", html: "¿por qué?", onclick: () => showWhy(v) }),
  ]);

  const body = el("div", { class: "card-body" }, [
    el("p", { class: "card-title", html: escapeHtml(v.title || "") }),
    el("div", { class: "card-meta" }, [
      el("span", { html: escapeHtml(v.channel_title || "") }),
      el("span", { html: "· " + fmtViews(v.view_count) + " vistas" }),
    ]),
    actions,
  ]);

  return el("article", { class: "card" }, [thumb, body]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---------- Feed ----------
async function resetFeed() {
  state.offset = 0;
  state.done = false;
  document.getElementById("grid").innerHTML = "";
  document.getElementById("featured").hidden = true;
  document.getElementById("featured").innerHTML = "";
  await loadMore(true);
}

async function loadMore(isFirst = false) {
  if (state.loading || state.done) return;
  state.loading = true;
  const btn = document.getElementById("load-more");
  btn.disabled = true;
  try {
    const data = await api(
      `/api/videos?mode=${state.mode}&offset=${state.offset}&limit=${state.limit}`
    );
    state.total = data.total;

    const grid = document.getElementById("grid");
    let items = data.items;

    // Joya #1 destacada (solo en la primera pagina del modo joyas).
    if (isFirst && items.length && (state.mode === "joyas")) {
      const feat = document.getElementById("featured");
      feat.innerHTML = "";
      feat.append(cardEl(items[0], true));
      feat.hidden = false;
      items = items.slice(1);
    }

    for (const v of items) grid.append(cardEl(v));
    state.offset += data.returned;

    document.getElementById("empty").hidden = state.total > 0;
    if (state.offset >= state.total) state.done = true;
    btn.hidden = state.done;

    // Auto-crawl si el corpus se agota.
    if (data.low_on_corpus) {
      showStatus("Corpus bajo: buscando más joyas automáticamente…");
      await doCrawl(true);
    } else {
      hideStatus();
    }
  } catch (e) {
    showStatus("Error: " + e.message);
  } finally {
    state.loading = false;
    document.getElementById("load-more").disabled = false;
  }
}

function showStatus(msg) {
  const s = document.getElementById("status-bar");
  s.textContent = msg;
  s.hidden = false;
}
function hideStatus() {
  document.getElementById("status-bar").hidden = true;
}

// ---------- Crawl ----------
async function doCrawl(auto = false) {
  try {
    const data = await api("/api/crawl", { method: "POST", body: "{}" });
    if (data.error) {
      showStatus(`Crawl: ${data.error}. ${data.hint || ""}`);
      return;
    }
    showStatus(
      `Crawl: +${data.new_videos} videos nuevos (cola pendiente: ${data.remaining_pending}).`
    );
    if (data.new_videos > 0) await resetFeed();
    else if (!auto) setTimeout(hideStatus, 4000);
  } catch (e) {
    showStatus("Crawl falló: " + e.message);
  }
}

// ---------- Guardar ----------
async function toggleSave(v, btn) {
  const saved = state.savedIds.has(v.video_id);
  try {
    if (saved) {
      await api(`/api/saved?video_id=${encodeURIComponent(v.video_id)}`, { method: "DELETE" });
      state.savedIds.delete(v.video_id);
      btn.classList.remove("is-saved");
      btn.innerHTML = "★ Guardar";
    } else {
      await api("/api/saved", { method: "POST", body: JSON.stringify({ video_id: v.video_id }) });
      state.savedIds.add(v.video_id);
      btn.classList.add("is-saved");
      btn.innerHTML = "★ Guardado";
    }
  } catch (e) {
    showStatus("No se pudo guardar: " + e.message);
  }
}

// ---------- "ver por que" ----------
function showWhy(v) {
  const body = document.getElementById("why-body");
  body.innerHTML = "";
  body.append(el("div", { class: "why-total", html: `Score total: ${v.score} / 100` }));
  const labels = {
    engagement: "Engagement",
    relevance: "Relevancia",
    depth: "Profundidad",
    duration: "Duración",
    captions: "Subtítulos",
    authority: "Autoridad",
  };
  for (const [key, info] of Object.entries(v.breakdown || {})) {
    const row = el("div", { class: "why-row" }, [
      el("span", { class: "lab", html: labels[key] || key }),
      el("span", { class: "bar" }, [el("i", { style: `width:${info.sub}%` })]),
      el("span", { class: "num", html: `${info.points}/${info.weight}` }),
    ]);
    body.append(row);
  }
  document.getElementById("why-modal").hidden = false;
}

// ---------- Panel Algoritmo ----------
function renderAlgoPanel() {
  const s = state.settings;
  const weights = document.getElementById("weights");
  weights.innerHTML = "";
  const labels = {
    engagement: "Engagement",
    relevance: "Relevancia",
    depth: "Profundidad",
    duration: "Duración",
    captions: "Subtítulos",
    authority: "Autoridad",
  };
  for (const key of Object.keys(s.WEIGHTS)) {
    const row = el("div", { class: "weight-row" }, [
      el("label", { html: labels[key] || key }),
      el("input", {
        type: "range", min: "0", max: "60", step: "1", value: s.WEIGHTS[key],
        oninput: (e) => {
          s.WEIGHTS[key] = parseInt(e.target.value, 10);
          row.querySelector(".val").textContent = s.WEIGHTS[key];
          updateWeightsSum();
          saveSettingsDebounced();
        },
      }),
      el("span", { class: "val", html: String(s.WEIGHTS[key]) }),
    ]);
    weights.append(row);
  }
  updateWeightsSum();

  document.getElementById("dur-min").value = s.MIN_DURATION;
  document.getElementById("dur-lo").value = s.DURATION_SWEET[0];
  document.getElementById("dur-hi").value = s.DURATION_SWEET[1];

  renderTags("tags-interest", s.INTEREST_KEYWORDS, false);
  renderTags("tags-hate", s.HATE_KEYWORDS, true);
  renderTags("tags-seeds", s.SEEDS, false);
}

function updateWeightsSum() {
  const sum = Object.values(state.settings.WEIGHTS).reduce((a, b) => a + b, 0);
  document.getElementById("weights-sum").textContent = `(suman ${sum})`;
}

function renderTags(containerId, arr, hate) {
  const c = document.getElementById(containerId);
  c.innerHTML = "";
  arr.forEach((tag, i) => {
    c.append(
      el("span", { class: "tag" + (hate ? " hate" : "") }, [
        el("span", { html: escapeHtml(tag) }),
        el("button", { html: "✕", onclick: () => { arr.splice(i, 1); renderTags(containerId, arr, hate); saveSettingsDebounced(); } }),
      ])
    );
  });
}

let saveTimer = null;
function saveSettingsDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const data = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: state.settings }),
      });
      state.settings = data.settings;
      await resetFeed(); // re-rankea en vivo
    } catch (e) {
      showStatus("No se pudo guardar el algoritmo: " + e.message);
    }
  }, 450);
}

// ---------- Saved tab ----------
async function loadSaved() {
  const ul = document.getElementById("saved-list");
  ul.innerHTML = "";
  const data = await api("/api/saved");
  const items = data.items || [];
  document.getElementById("saved-empty").hidden = items.length > 0;
  for (const it of items) ul.append(savedItemEl(it));
  enableDragReorder(ul);
}

function savedItemEl(it) {
  const li = el("li", { class: "saved-item", draggable: "true", "data-id": it.video_id }, [
    el("span", { class: "saved-handle", html: "⠿" }),
    el("img", { loading: "lazy", src: it.thumbnail_url || "", alt: "" }),
    el("div", { class: "saved-main" }, [
      el("p", { class: "t", html: escapeHtml(it.title || it.video_id) }),
      el("input", {
        class: "note", type: "text", placeholder: "Nota…", value: it.note || "",
        onchange: (e) => api("/api/saved", { method: "POST", body: JSON.stringify({ video_id: it.video_id, note: e.target.value }) }),
      }),
    ]),
    el("div", { class: "saved-actions" }, [
      el("a", { class: "watch", href: it.url || `https://youtu.be/${it.video_id}`, target: "_blank", rel: "noopener", html: "▶" }),
      el("button", { class: "ghost-btn", html: "Quitar", onclick: async () => { await api(`/api/saved?video_id=${encodeURIComponent(it.video_id)}`, { method: "DELETE" }); state.savedIds.delete(it.video_id); loadSaved(); } }),
    ]),
  ]);
  return li;
}

function enableDragReorder(ul) {
  let dragEl = null;
  ul.querySelectorAll(".saved-item").forEach((li) => {
    li.addEventListener("dragstart", () => { dragEl = li; li.classList.add("dragging"); });
    li.addEventListener("dragend", async () => {
      li.classList.remove("dragging");
      ul.querySelectorAll(".drag-over").forEach((x) => x.classList.remove("drag-over"));
      const order = [...ul.querySelectorAll(".saved-item")].map((x) => x.dataset.id);
      await api("/api/saved/order", { method: "PUT", body: JSON.stringify({ order }) });
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = (e.clientY - li.getBoundingClientRect().top) > li.offsetHeight / 2;
      li.classList.add("drag-over");
      if (dragEl && dragEl !== li) {
        ul.insertBefore(dragEl, after ? li.nextSibling : li);
      }
    });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
  });
}

// ---------- Vistas / nav ----------
function showView(name) {
  document.getElementById("view-feed").classList.toggle("is-active", name === "feed");
  document.getElementById("view-saved").classList.toggle("is-active", name === "saved");
  if (name === "saved") loadSaved();
}

function openPanel(open) {
  document.getElementById("algo-panel").classList.toggle("is-open", open);
  document.getElementById("overlay").hidden = !open;
}

// ---------- Init ----------
async function loadSavedIds() {
  try {
    const data = await api("/api/saved");
    state.savedIds = new Set((data.items || []).map((i) => i.video_id));
  } catch { /* noop */ }
}

function wireEvents() {
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      state.mode = b.dataset.mode;
      showView("feed");
      resetFeed();
    });
  });
  document.getElementById("open-algo").addEventListener("click", () => openPanel(true));
  document.getElementById("close-algo").addEventListener("click", () => openPanel(false));
  document.getElementById("overlay").addEventListener("click", () => openPanel(false));
  document.getElementById("open-saved").addEventListener("click", () => showView("saved"));
  document.getElementById("load-more").addEventListener("click", () => loadMore(false));
  document.getElementById("empty-crawl").addEventListener("click", () => doCrawl(false));
  document.getElementById("close-why").addEventListener("click", () => (document.getElementById("why-modal").hidden = true));
  document.getElementById("reset-algo").addEventListener("click", async () => {
    const data = await api("/api/settings", { method: "DELETE" });
    state.settings = data.settings;
    renderAlgoPanel();
    await resetFeed();
  });

  // Inputs de duracion.
  const durHandler = () => {
    state.settings.MIN_DURATION = parseInt(document.getElementById("dur-min").value || "0", 10);
    state.settings.DURATION_SWEET = [
      parseInt(document.getElementById("dur-lo").value || "0", 10),
      parseInt(document.getElementById("dur-hi").value || "0", 10),
    ];
    saveSettingsDebounced();
  };
  ["dur-min", "dur-lo", "dur-hi"].forEach((id) => document.getElementById(id).addEventListener("change", durHandler));

  // Los inputs de tags (intereses/penalizadas/semillas) se cablean en
  // wireTagInputsAfterSettings(), una vez cargado state.settings.

  // Infinite scroll.
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMore(false);
  });
  io.observe(document.getElementById("sentinel"));
}

function wireTagInputsAfterSettings() {
  const bind = (inputId, arr, container, hate) => {
    const inp = document.getElementById(inputId);
    const fresh = inp.cloneNode(true); // limpia listeners viejos
    inp.replaceWith(fresh);
    fresh.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && fresh.value.trim()) {
        arr.push(fresh.value.trim());
        fresh.value = "";
        renderTags(container, arr, hate);
        saveSettingsDebounced();
      }
    });
  };
  bind("add-interest", state.settings.INTEREST_KEYWORDS, "tags-interest", false);
  bind("add-hate", state.settings.HATE_KEYWORDS, "tags-hate", true);
  bind("add-seed", state.settings.SEEDS, "tags-seeds", false);
}

async function init() {
  wireEvents();
  // Auth gate (opcional).
  try {
    const auth = await fetch("/api/auth").then((r) => r.json());
    if (auth.auth_required && !localStorage.getItem(LS_PW)) {
      const pw = window.prompt("Esta app pide contraseña:");
      if (pw) localStorage.setItem(LS_PW, pw);
    }
  } catch { /* noop */ }

  const sett = await api("/api/settings");
  state.settings = sett.settings;
  state.mode = state.settings.DEFAULT_MODE || "joyas";
  renderAlgoPanel();
  wireTagInputsAfterSettings();
  await loadSavedIds();
  await resetFeed();
}

init();
