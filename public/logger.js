/**
 * logger.js — Sistema de logs interno para YouTube Tops.
 *
 * Guarda los últimos 150 eventos en localStorage.
 * Los errores se capturan globalmente (window.onerror, unhandledrejection).
 *
 * Debug desde la consola del navegador:
 *   __log.getLogs()    — ver todos los logs
 *   __log.getErrors()  — solo errores
 *   __log.table(30)    — últimas 30 entradas como tabla
 *   __log.download()   — descargar como JSON
 *   __log.clear()      — limpiar
 */

const STORAGE_KEY = 'yt_tops_logs';
const MAX_ENTRIES  = 150;

function persist(entry) {
  try {
    const all = getAll();
    all.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_ENTRIES)));
  } catch {}
}

function getAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function makeEntry(level, message, data) {
  return {
    ts:      new Date().toISOString(),
    level,
    message: String(message),
    data:    data !== undefined ? (typeof data === 'object' ? safeStr(data) : String(data)) : null,
    url:     location.pathname + location.search,
  };
}

function safeStr(obj) {
  try { return JSON.stringify(obj, null, 0); } catch { return String(obj); }
}

export const logger = {
  info(message, data) {
    persist(makeEntry('info', message, data));
    console.info(`%c[YT-Tops]%c ${message}`, 'color:#60a5fa;font-weight:700', 'color:inherit', data ?? '');
  },
  warn(message, data) {
    persist(makeEntry('warn', message, data));
    console.warn(`[YT-Tops WARN] ${message}`, data ?? '');
  },
  error(message, data) {
    persist(makeEntry('error', message, data));
    console.error(`[YT-Tops ERROR] ${message}`, data ?? '');
  },
  time(label) {
    const start = performance.now();
    return {
      end(extraData) {
        const ms    = Math.round(performance.now() - start);
        persist(makeEntry('perf', label, { ms, ...extraData }));
        const color = ms > 2000 ? 'color:#ef4444' : ms > 800 ? 'color:#f59e0b' : 'color:#22c55e';
        console.info(`%c[YT-Tops ⏱] ${label} → ${ms}ms`, color);
      }
    };
  },
  getLogs()   { return getAll(); },
  getErrors() { return getAll().filter(e => e.level === 'error'); },
  clear()     { localStorage.removeItem(STORAGE_KEY); console.info('[YT-Tops] Logs borrados'); },
  download()  {
    const blob = new Blob([JSON.stringify(getAll(), null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `yt-tops-logs-${Date.now()}.json`;
    a.click();
  },
  table(n = 20) { console.table(getAll().slice(-n)); },
};

window.addEventListener('error', ev => {
  logger.error(`Uncaught: ${ev.message}`, {
    file:  ev.filename?.split('/').pop(),
    line:  ev.lineno,
    col:   ev.colno,
    stack: ev.error?.stack?.split('\n').slice(0, 3).join(' | '),
  });
});

window.addEventListener('unhandledrejection', ev => {
  const msg = ev.reason?.message || String(ev.reason);
  logger.error(`UnhandledPromise: ${msg}`, {
    stack: ev.reason?.stack?.split('\n').slice(0, 3).join(' | '),
  });
});

window.__log = logger;
logger.info('Logger iniciado', { version: '1.1', maxEntries: MAX_ENTRIES });
