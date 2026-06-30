/**
 * quota.js – Seguimiento de cuota de YouTube Data API en D1.
 *
 * Costos (unidades):
 *   search.list   = 100 por llamada
 *   videos.list   = 1 por lote de 50
 *   channels.list = 1 por lote de 50
 */

import { BUDGET } from '../../config.js';

export async function getUsedUnits(db) {
  const today = todayISO();
  const row   = await db
    .prepare('SELECT search_units_used FROM quota_log WHERE day = ?')
    .bind(today).first();
  return row?.search_units_used ?? 0;
}

export async function addUnits(db, units) {
  if (!units || units <= 0) return;
  const today = todayISO();
  await db.prepare(`
    INSERT INTO quota_log (day, search_units_used) VALUES (?, ?)
    ON CONFLICT(day) DO UPDATE SET search_units_used = search_units_used + excluded.search_units_used
  `).bind(today, units).run();
}

export async function hasQuota(db, needed) {
  const used = await getUsedUnits(db);
  return used + needed <= BUDGET.daily_limit;
}

export function estimateRoundCost(searches, videoCount, channelCount) {
  return searches * 100 + Math.ceil(videoCount / 50) + Math.ceil(channelCount / 50);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}
