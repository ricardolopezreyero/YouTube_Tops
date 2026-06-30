// src/lib/quota.js
// Contabilidad de cuota de la YouTube Data API v3.
// Costos: search.list = 100 unidades; videos.list / channels.list = 1 unidad (por lote de 50).
// Se registra el consumo por dia (UTC) en la tabla quota_log.

export const COST = {
  SEARCH: 100,
  VIDEOS: 1,
  CHANNELS: 1,
};

export function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Suma `units` al consumo del dia y devuelve el total acumulado.
export async function addUnits(DB, units) {
  const day = today();
  await DB.prepare(
    `INSERT INTO quota_log (day, search_units_used)
     VALUES (?1, ?2)
     ON CONFLICT(day) DO UPDATE SET search_units_used = search_units_used + ?2`
  )
    .bind(day, units)
    .run();
  return getUsedToday(DB);
}

export async function getUsedToday(DB) {
  const day = today();
  const row = await DB.prepare(
    `SELECT search_units_used AS used FROM quota_log WHERE day = ?1`
  )
    .bind(day)
    .first();
  return row ? row.used || 0 : 0;
}

// Acumulador en memoria para una ronda de crawl/seed. Limita por numero de
// busquedas (search.list), que es el costo dominante (100u c/u).
export function createBudget(maxSearches) {
  let searches = 0;
  let units = 0;
  return {
    canSearch() {
      return searches < maxSearches;
    },
    spendSearch() {
      searches += 1;
      units += COST.SEARCH;
    },
    spendVideos(batches = 1) {
      units += batches * COST.VIDEOS;
    },
    spendChannels(batches = 1) {
      units += batches * COST.CHANNELS;
    },
    get searches() {
      return searches;
    },
    get units() {
      return units;
    },
  };
}
