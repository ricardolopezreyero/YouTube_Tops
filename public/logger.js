/**
 * logger.js — Sistema de logs interno para YouTube Tops.
 *
 * Guarda los últimos 150 eventos en localStorage.
 * Los errores se capturan globalmente (window.onerror, unhandledrejection).
 *
 * Debug desde la consola del navegador:
 *   __log.getLogs()          — ver todos los logs
 *   __log.getErrors()        — solo errores
 *   __log.clear()            — limpiar
 *   __log.download()         — descargar como JSON
 */

const STORAGE_KEY = 'yt_tops_logs';
const MAX_ENTRIES  = 150;

function persist(entry) {
  try {
    const all = getAll();
    all.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_ENTRIES)));
  } catch { /* localStorage lleno o unavailable */ }
}

function getAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function makeEntry(level, message, data) {
  return {
    ts:      new Date().toISOString(),
    level,
    message: String(message),
    data:    data !== undefined ? (typeof data === 'object' ? safeStringify(data) : String(data)) : null,
    url:     location.pathname + location.search,
  };
}

function safeStringify(obj) {
  try { return JSON.stringify(obj, null, 0); } catch { return String(obj); }
}

export const logger = {
  info(message, data) {
    const e = makeEntry('info', message, data);
    persist(e);
    console.info(`%c[YT-Tops]%c ${message}`, 'color:#60a5fa;font-weight:700', 'color:inherit', data ?? '');
  },
  warn(message, data) {
    const e = makeEntry('warn', message, data);
    persist(e);
    console.warn(`[YT-Tops WARN] ${message}`, data ?? '');
  },
  error(message, data) {
    const e = makeEntry('error', message, data);
    persist(e);
    console.error(`[YT-Tops ERROR] ${message}`, data ?? '');
  },
  /** Log de rendimiento: tiempo de llamada a API */
  time(label) {
    const start = performance.now();
    return {
      end(extraData) {
        const ms = Math.round(performance.now() - start);
        const entry = makeEntry('perf', label, { ms, ...extraData });
        persist(entry);
        const color = ms > 2000 ? 'color:#ef4444' : ms > 800 ? 'color:#f59e0b' : 'color:#22c55e';
        console.info(`%c[YT-Tops ⏱] ${label} → ${ms}ms`, color);
      }
    };
  },

  /* ── Lectura ────────────────────────────────────────────────────────────── */
  getLogs()   { return getAll(); },
  getErrors() { return getAll().filter(e => e.level === 'error'); },
  clear()     { localStorage.removeItem(STORAGE_KEY); console.info('[YT-Tops] Logs borrados'); },
  download()  {
    const blob = new Blob([JSON.stringify(getAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yt-tops-logs-${Date.now()}.json`;
    a.click();
  },
  /** Últimas N entradas como tabla en consola */
  table(n = 20) { console.table(getAll().slice(-n)); },
};

/* ── Captura global de errores ──────────────────────────────────────────────── */
window.addEventListener('error', ev => {
  logger.error(`Uncaught: ${ev.message}`, {
    file: ev.filename?.split('/').pop(),
    line: ev.lineno,
    col:  ev.colno,
    stack: ev.error?.stack?.split('\n').slice(0,3).join(' | '),
  });
});

window.addEventListener('unhandledrejection', ev => {
  const msg = ev.reason?.message || String(ev.reason);
  logger.error(`UnhandledPromise: ${msg}`, {
    stack: ev.reason?.stack?.split('\n').slice(0,3).join(' | '),
  });
});

/* ── Exponer en window para debugging ───────────────────────────────────────── */
window.__log = logger;
logger.info('Logger iniciado', { version: '1.0', maxEntries: MAX_ENTRIES });
