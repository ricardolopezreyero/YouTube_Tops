// src/lib/crawler.js
// Crawler de 3 capas usando search_queue.
//   Capa 0: encola SEEDS.
//   Capa 1: procesa seeds (type=video).
//   Capa 2: extrae canales y terminos recurrentes de los resultados y los encola.
//   Capa 3+: repite desde la logica de capa 2.
// Respeta el BUDGET (max busquedas por ronda); deja el resto en 'pending'.
// Nunca re-busca/re-enriquece lo que ya existe en D1.

import { searchVideos, getVideoDetails, getChannelDetails } from "./youtube.js";
import { scoreVideo } from "./scoring.js";
import { createBudget, addUnits } from "./quota.js";

// --- Persistencia en D1 (compartida con seed.js) ---

export async function persistVideos(DB, videos, channelsById, settings, meta = {}) {
  let inserted = 0;
  for (const v of videos) {
    const { score } = scoreVideo(v, settings, channelsById);
    const res = await DB.prepare(
      `INSERT OR IGNORE INTO videos
        (video_id, title, channel_id, channel_title, description, published_at,
         duration_seconds, view_count, like_count, comment_count, has_captions,
         has_chapters, thumbnail_url, url, score_base, discovered_query, discovered_layer)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`
    )
      .bind(
        v.video_id,
        v.title,
        v.channel_id,
        v.channel_title,
        v.description,
        v.published_at,
        v.duration_seconds,
        v.view_count,
        v.like_count,
        v.comment_count,
        v.has_captions,
        v.has_chapters,
        v.thumbnail_url,
        v.url,
        score,
        meta.query || null,
        meta.layer || 1
      )
      .run();
    if (res.meta && res.meta.changes > 0) inserted += 1;
  }
  return inserted;
}

export async function persistChannels(DB, channels) {
  for (const c of channels) {
    await DB.prepare(
      `INSERT INTO channels (channel_id, title, subscriber_count, authority_score, updated_at)
       VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT(channel_id) DO UPDATE SET
         title=excluded.title,
         subscriber_count=excluded.subscriber_count,
         authority_score=excluded.authority_score,
         updated_at=excluded.updated_at`
    )
      .bind(
        c.channel_id,
        c.title,
        c.subscriber_count,
        c.authority_score,
        c.updated_at
      )
      .run();
  }
}

// Encola SEEDS en la capa 0 (idempotente gracias a UNIQUE(query)).
export async function enqueueSeeds(DB, seeds) {
  let added = 0;
  for (const q of seeds) {
    const res = await DB.prepare(
      `INSERT OR IGNORE INTO search_queue (query, layer, source, status)
       VALUES (?1, 1, 'seed', 'pending')`
    )
      .bind(q)
      .run();
    if (res.meta && res.meta.changes > 0) added += 1;
  }
  return added;
}

// Extrae terminos recurrentes (palabras del titulo) y canales de un lote de videos,
// y los encola como nuevas busquedas en la siguiente capa.
async function enqueueDerived(DB, videos, channels, nextLayer) {
  const termCount = new Map();
  const stop = new Set([
    "the", "and", "for", "with", "que", "para", "con", "los", "las", "una",
    "del", "como", "how", "you", "your", "this", "that", "de", "la", "el",
    "en", "un", "to", "of", "in", "is", "video", "best", "top",
  ]);
  for (const v of videos) {
    for (const t of (v.title || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)) {
      if (t.length > 3 && !stop.has(t)) {
        termCount.set(t, (termCount.get(t) || 0) + 1);
      }
    }
  }
  // Terminos que aparecen >=3 veces se vuelven nuevas busquedas.
  const terms = [...termCount.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  // Canales con mas autoridad se exploran por nombre.
  const channelQueries = channels
    .sort((a, b) => (b.subscriber_count || 0) - (a.subscriber_count || 0))
    .slice(0, 5)
    .map((c) => c.title)
    .filter(Boolean);

  let added = 0;
  for (const q of [...terms, ...channelQueries]) {
    const res = await DB.prepare(
      `INSERT OR IGNORE INTO search_queue (query, layer, source, status)
       VALUES (?1, ?2, 'derived', 'pending')`
    )
      .bind(q, nextLayer)
      .run();
    if (res.meta && res.meta.changes > 0) added += 1;
  }
  return added;
}

// Procesa la siguiente tanda de busquedas pendientes (menor layer primero)
// dentro del BUDGET. Enriquece, guarda en D1 y encola derivados.
// Devuelve un resumen para el endpoint /api/crawl.
export async function processNextLayer(DB, CACHE, apiKey, settings) {
  const maxSearches = (settings.BUDGET && settings.BUDGET.max_search_per_round) || 12;
  const budget = createBudget(maxSearches);

  const pending = await DB.prepare(
    `SELECT id, query, layer FROM search_queue
     WHERE status = 'pending'
     ORDER BY layer ASC, id ASC
     LIMIT ?1`
  )
    .bind(maxSearches)
    .all();

  const rows = (pending && pending.results) || [];
  if (rows.length === 0) {
    return { processed: 0, new_videos: 0, units_used: 0, remaining_pending: 0 };
  }

  let totalNew = 0;
  const allVideos = [];
  const allChannels = [];
  let processed = 0;
  let maxLayerSeen = 1;

  for (const row of rows) {
    if (!budget.canSearch()) break;
    budget.spendSearch();
    maxLayerSeen = Math.max(maxLayerSeen, row.layer || 1);

    let videoIds = [];
    try {
      videoIds = await searchVideos(apiKey, row.query, { CACHE, max: 25 });
    } catch (e) {
      await DB.prepare(
        `UPDATE search_queue SET status='error', processed_at=?2 WHERE id=?1`
      )
        .bind(row.id, new Date().toISOString())
        .run();
      continue;
    }

    // No re-enriquecer lo existente.
    let newIds = videoIds;
    if (videoIds.length > 0) {
      const placeholders = videoIds.map((_, i) => `?${i + 1}`).join(",");
      const existing = await DB.prepare(
        `SELECT video_id FROM videos WHERE video_id IN (${placeholders})`
      )
        .bind(...videoIds)
        .all();
      const existingSet = new Set(
        ((existing && existing.results) || []).map((r) => r.video_id)
      );
      newIds = videoIds.filter((id) => !existingSet.has(id));
    }

    let videos = [];
    if (newIds.length > 0) {
      videos = await getVideoDetails(apiKey, newIds, { CACHE });
      budget.spendVideos(Math.ceil(newIds.length / 50));
    }

    const channelIds = [...new Set(videos.map((v) => v.channel_id))];
    let channels = [];
    if (channelIds.length > 0) {
      channels = await getChannelDetails(apiKey, channelIds, { CACHE });
      budget.spendChannels(Math.ceil(channelIds.length / 50));
    }

    await persistChannels(DB, channels);
    const channelsById = Object.fromEntries(channels.map((c) => [c.channel_id, c]));
    const inserted = await persistVideos(DB, videos, channelsById, settings, {
      query: row.query,
      layer: row.layer,
    });
    totalNew += inserted;
    allVideos.push(...videos);
    allChannels.push(...channels);

    await DB.prepare(
      `UPDATE search_queue SET status='done', processed_at=?2 WHERE id=?1`
    )
      .bind(row.id, new Date().toISOString())
      .run();
    processed += 1;
  }

  // Encola derivados para la siguiente capa (capa 2/3).
  let enqueued = 0;
  if (allVideos.length > 0) {
    enqueued = await enqueueDerived(DB, allVideos, allChannels, maxLayerSeen + 1);
  }

  // Registra cuota consumida en el dia.
  if (budget.units > 0) {
    await addUnits(DB, budget.units);
  }

  const remaining = await DB.prepare(
    `SELECT COUNT(*) AS n FROM search_queue WHERE status='pending'`
  ).first();

  return {
    processed,
    new_videos: totalNew,
    derived_enqueued: enqueued,
    units_used: budget.units,
    searches_used: budget.searches,
    remaining_pending: (remaining && remaining.n) || 0,
  };
}
