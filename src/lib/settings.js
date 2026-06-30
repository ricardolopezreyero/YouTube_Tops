// src/lib/settings.js
// Lee/guarda "el algoritmo editable" en la tabla settings (D1).
// Los valores de DEFAULTS (config.js) se usan como base; lo guardado los sobrescribe.

import DEFAULTS from "../../config.js";

const SETTINGS_KEY = "algorithm";

// Devuelve el algoritmo efectivo: DEFAULTS sobreescrito por lo persistido.
export async function getSettings(DB) {
  const row = await DB.prepare(
    `SELECT value FROM settings WHERE key = ?1`
  )
    .bind(SETTINGS_KEY)
    .first();

  let stored = {};
  if (row && row.value) {
    try {
      stored = JSON.parse(row.value);
    } catch {
      stored = {};
    }
  }
  return mergeSettings(DEFAULTS, stored);
}

// Guarda el algoritmo (merge superficial sobre DEFAULTS para validar forma).
export async function saveSettings(DB, incoming) {
  const merged = mergeSettings(DEFAULTS, incoming || {});
  await DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(SETTINGS_KEY, JSON.stringify(merged))
    .run();
  return merged;
}

// Restaura defaults borrando lo persistido.
export async function resetSettings(DB) {
  await DB.prepare(`DELETE FROM settings WHERE key = ?1`).bind(SETTINGS_KEY).run();
  return { ...DEFAULTS };
}

function mergeSettings(base, override) {
  return {
    SEEDS: override.SEEDS ?? base.SEEDS,
    INTEREST_KEYWORDS: override.INTEREST_KEYWORDS ?? base.INTEREST_KEYWORDS,
    HATE_KEYWORDS: override.HATE_KEYWORDS ?? base.HATE_KEYWORDS,
    DEPTH_KEYWORDS: override.DEPTH_KEYWORDS ?? base.DEPTH_KEYWORDS,
    WEIGHTS: { ...base.WEIGHTS, ...(override.WEIGHTS || {}) },
    DURATION_SWEET: override.DURATION_SWEET ?? base.DURATION_SWEET,
    MIN_DURATION: override.MIN_DURATION ?? base.MIN_DURATION,
    BUDGET: { ...base.BUDGET, ...(override.BUDGET || {}) },
    DEFAULT_MODE: override.DEFAULT_MODE ?? base.DEFAULT_MODE,
  };
}

export { DEFAULTS };
