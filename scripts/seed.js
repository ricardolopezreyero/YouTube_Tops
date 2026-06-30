#!/usr/bin/env node
/**
 * scripts/seed.js — Seed del corpus D1 con una ronda de YouTube.
 *
 * Uso:
 *   npm run seed
 *
 * Requisitos previos:
 *   1. Haber corrido `wrangler d1 migrations apply youtube_tops --remote`
 *   2. YOUTUBE_API_KEY en el entorno (o en .dev.vars)
 *   3. Estar autenticado con wrangler (`wrangler login` o CLOUDFLARE_API_TOKEN)
 *
 * El script:
 *   1. Llama a YouTube search.list para cada seed en SEEDS_DEFAULT
 *   2. Enriquece con videos.list (stats, contentDetails) + channels.list
 *   3. Puntúa cada video con WEIGHTS_DEFAULT
 *   4. Genera un archivo SQL temporal
 *   5. Lo ejecuta contra D1 remoto via `wrangler d1 execute`
 *
 * Cuota estimada:
 *   10 búsquedas × 100u = 1000u + ~3u (videos+channels) ≈ 1003 unidades
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Cargar .dev.vars si existe ────────────────────────────────────────────────
const devVarsPath = join(ROOT, '.dev.vars');
if (existsSync(devVarsPath)) {
  const lines = readFileSync(devVarsPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Importar config del proyecto ──────────────────────────────────────────────
const { SEEDS_DEFAULT, WEIGHTS_DEFAULT, DEPTH_KEYWORDS, DURATION_SWEET, MIN_DURATION, BUDGET } =
  await import('../config.js');

const { searchVideos, enrichVideos, enrichChannels, parseDuration, detectChapters, formatVideo, formatChannel } =
  await import('../src/lib/youtube.js');

// ── Validar API key ───────────────────────────────────────────────────────────
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
if (!YOUTUBE_API_KEY) {
  console.error('\n❌  YOUTUBE_API_KEY no encontrada.');
  console.error('   Crea un archivo .dev.vars en la raíz con:\n');
  console.error('   YOUTUBE_API_KEY=tu_clave_aqui\n');
  process.exit(1);
}

// ── Función de scoring simplificada (sin importar el módulo Worker) ───────────
function scoreBaseSimple(video, channel) {
  const views    = video.view_count    || 0;
  const likes    = video.like_count    || 0;
  const comments = video.comment_count || 0;
  const dur      = video.duration_seconds || 0;
  const subs     = channel?.subscriber_count || 0;

  const likeRatio    = views > 0 ? likes    / views : 0;
  const commentRatio = views > 0 ? comments / views : 0;
  let eng = Math.min(1, likeRatio / 0.04) * 0.65 + Math.min(1, commentRatio / 0.003) * 0.35;
  if (views > 5_000_000 && eng < 0.25) eng *= 0.5;

  const text = `${video.title} ${video.description || ''}`.toLowerCase();
  const depthHits = DEPTH_KEYWORDS.filter(k => text.includes(k.toLowerCase())).length;
  const hasChapters = video.has_chapters === 1;
  const depth = Math.min(1, depthHits / 3) * 0.7 + (hasChapters ? 1 : 0) * 0.3;

  let durScore = 0;
  if (dur >= MIN_DURATION) {
    if (dur >= DURATION_SWEET[0] && dur <= DURATION_SWEET[1]) durScore = 1;
    else if (dur < DURATION_SWEET[0]) durScore = (dur - MIN_DURATION) / (DURATION_SWEET[0] - MIN_DURATION);
    else durScore = Math.max(0, 1 - (dur - DURATION_SWEET[1]) / DURATION_SWEET[1]);
  }

  const captions  = video.has_captions === 1 ? 1 : 0;
  const authority = Math.min(1, Math.log10(subs + 1) / 7);

  const w = WEIGHTS_DEFAULT;
  const tw = Object.values(w).reduce((a, b) => a + b, 0);
  return (w.engagement * eng + w.relevance * 0.5 + w.depth * depth +
          w.duration * durScore + w.captions * captions + w.authority * authority) / tw;
}

// ── Escapar strings para SQL ──────────────────────────────────────────────────
function sqlStr(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

// ── Generar SQL para upsert de video ──────────────────────────────────────────
function videoInsertSQL(v) {
  return `INSERT OR REPLACE INTO videos (
    video_id, title, channel_id, channel_title, description, published_at,
    duration_seconds, view_count, like_count, comment_count,
    has_captions, has_chapters, thumbnail_url, url,
    score_base, discovered_query, discovered_layer, created_at
  ) VALUES (
    ${sqlStr(v.video_id)}, ${sqlStr(v.title)}, ${sqlStr(v.channel_id)},
    ${sqlStr(v.channel_title)}, ${sqlStr(v.description)}, ${sqlStr(v.published_at)},
    ${v.duration_seconds ?? 0}, ${v.view_count ?? 0}, ${v.like_count ?? 0},
    ${v.comment_count ?? 0}, ${v.has_captions ?? 0}, ${v.has_chapters ?? 0},
    ${sqlStr(v.thumbnail_url)}, ${sqlStr(v.url)},
    ${v.score_base ?? 0}, ${sqlStr(v.discovered_query)}, ${v.discovered_layer ?? 1},
    CURRENT_TIMESTAMP
  );`;
}

function channelInsertSQL(c) {
  return `INSERT OR REPLACE INTO channels (channel_id, title, subscriber_count, authority_score, updated_at)
  VALUES (${sqlStr(c.channel_id)}, ${sqlStr(c.title)}, ${c.subscriber_count ?? 0}, ${c.authority_score ?? 0}, CURRENT_TIMESTAMP);`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const seeds = SEEDS_DEFAULT.slice(0, BUDGET.max_search_per_round);
  console.log(`\n🎯  YouTube Tops — Seed Script`);
  console.log(`   Semillas: ${seeds.length} de ${SEEDS_DEFAULT.length}`);
  console.log(`   Cuota estimada: ~${seeds.length * 100 + 5} unidades\n`);

  const allVideoIds   = new Set();
  const allChannelIds = new Set();
  const snippetMap    = {};  // videoId → search snippet
  const queryMap      = {};  // videoId → query
  const videoItems    = [];
  const channelItems  = [];

  // ── Paso 1: search.list ──────────────────────────────────────────────────
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    process.stdout.write(`  [${i + 1}/${seeds.length}] Buscando: "${seed.slice(0, 50)}"… `);
    try {
      const items = await searchVideos(YOUTUBE_API_KEY, seed, 10);
      let added = 0;
      for (const item of items) {
        const id = item.id?.videoId;
        if (!id) continue;
        if (!allVideoIds.has(id)) {
          allVideoIds.add(id);
          snippetMap[id] = item.snippet;
          queryMap[id]   = seed;
          added++;
        }
      }
      console.log(`✓ ${added} nuevos (total ${allVideoIds.size})`);
    } catch (err) {
      console.log(`✗ Error: ${err.message}`);
    }
    // Pequeña pausa para no martillar la API
    await sleep(300);
  }

  if (allVideoIds.size === 0) {
    console.error('\n❌  No se obtuvieron videos. Verifica tu YOUTUBE_API_KEY.\n');
    process.exit(1);
  }

  // ── Paso 2: videos.list (enriquecimiento) ────────────────────────────────
  console.log(`\n  Enriqueciendo ${allVideoIds.size} videos…`);
  const enriched = await enrichVideos(YOUTUBE_API_KEY, [...allVideoIds]);
  console.log(`  ✓ ${enriched.length} videos enriquecidos`);

  enriched.forEach(item => {
    const cd = item.contentDetails || {};
    const s  = item.snippet || {};
    const channelId = s.channelId;
    if (channelId) allChannelIds.add(channelId);
  });

  // ── Paso 3: channels.list (autoridad) ────────────────────────────────────
  console.log(`\n  Obteniendo datos de ${allChannelIds.size} canales…`);
  const channels = await enrichChannels(YOUTUBE_API_KEY, [...allChannelIds]);
  console.log(`  ✓ ${channels.length} canales obtenidos`);

  const channelMap = {};
  channels.forEach(ch => {
    const fc = formatChannel(ch);
    channelMap[fc.channel_id] = fc;
    channelItems.push(fc);
  });

  // ── Paso 4: Formatear videos y calcular score_base ────────────────────────
  let skipped = 0;
  for (const item of enriched) {
    const dur = parseDuration(item.contentDetails?.duration);
    if (dur < MIN_DURATION) { skipped++; continue; }

    const fv = formatVideo(item, channelMap, queryMap[item.id] || '', 0);
    fv.score_base = scoreBaseSimple(fv, channelMap[fv.channel_id]);
    videoItems.push(fv);
  }
  console.log(`\n  Videos finales: ${videoItems.length} (${skipped} descartados por duración < ${MIN_DURATION}s)`);

  if (videoItems.length === 0) {
    console.error('\n❌  No quedaron videos tras filtrar por duración mínima.\n');
    process.exit(1);
  }

  // ── Paso 5: Generar SQL ───────────────────────────────────────────────────
  const sqlLines = [
    '-- YouTube Tops seed data',
    `-- Generado: ${new Date().toISOString()}`,
    `-- Videos: ${videoItems.length}, Canales: ${channelItems.length}`,
    '',
  ];

  channelItems.forEach(c => sqlLines.push(channelInsertSQL(c)));
  sqlLines.push('');
  videoItems.forEach(v => sqlLines.push(videoInsertSQL(v)));

  const tmpFile = join(tmpdir(), `yt-tops-seed-${Date.now()}.sql`);
  writeFileSync(tmpFile, sqlLines.join('\n'), 'utf-8');
  console.log(`\n  SQL generado: ${tmpFile} (${sqlLines.length} líneas)`);

  // ── Paso 6: Ejecutar en D1 ────────────────────────────────────────────────
  console.log('\n  Ejecutando en D1 remoto (puede tardar 30-60s)…\n');
  const result = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', 'youtube_tops', '--remote', '--file', tmpFile],
    { encoding: 'utf-8', stdio: 'inherit', cwd: ROOT }
  );

  // Limpiar archivo temporal
  try { unlinkSync(tmpFile); } catch {}

  if (result.status !== 0) {
    console.error('\n❌  Error al ejecutar en D1.');
    console.error('   Asegúrate de haber corrido `wrangler login` o tener CLOUDFLARE_API_TOKEN en el entorno.');
    console.error('   También verifica que el database_id en wrangler.toml sea correcto.\n');
    process.exit(1);
  }

  console.log(`\n✅  Seed completado: ${videoItems.length} videos y ${channelItems.length} canales en D1.`);
  console.log('   Abre la app y disfruta tus joyas 🎯\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('\n❌  Error fatal:', err.message);
  process.exit(1);
});
