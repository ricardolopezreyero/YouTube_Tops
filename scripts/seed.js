// scripts/seed.js
// Siembra inicial: corre UNA ronda para que al abrir la app ya haya videos.
//
//   npm run seed         -> --remote (produccion; requiere YOUTUBE_API_KEY)
//   npm run seed:local   -> --local  (entorno local de wrangler)
//
// Si YOUTUBE_API_KEY esta disponible (env o .dev.vars), hace una ronda real de
// la YouTube API dentro del BUDGET. Si NO, usa fixtures (scripts/fixtures.js)
// para que la demo local corra end-to-end sin gastar cuota.
//
// La escritura a D1 se hace generando SQL y aplicandolo con `wrangler d1 execute`.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import DEFAULTS from "../config.js";
import { scoreVideo } from "../src/lib/scoring.js";
import { searchVideos, getVideoDetails, getChannelDetails } from "../src/lib/youtube.js";
import { createBudget } from "../src/lib/quota.js";
import { FIXTURE_VIDEOS, FIXTURE_CHANNELS } from "./fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_NAME = "youtube_tops";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const target = remote ? "--remote" : "--local";

function loadApiKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  const devVars = join(__dirname, "..", ".dev.vars");
  if (existsSync(devVars)) {
    const txt = readFileSync(devVars, "utf8");
    const m = txt.match(/^\s*YOUTUBE_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function gatherFromYouTube(apiKey) {
  console.log("[seed] Usando la YouTube Data API (una ronda dentro del BUDGET).");
  const budget = createBudget(DEFAULTS.BUDGET.max_search_per_round);
  const videosMap = new Map();
  const channelIds = new Set();

  for (const seed of DEFAULTS.SEEDS) {
    if (!budget.canSearch()) break;
    budget.spendSearch();
    let ids = [];
    try {
      ids = await searchVideos(apiKey, seed, { max: 15 });
    } catch (e) {
      console.warn(`[seed] search fallo para "${seed}": ${e.message}`);
      continue;
    }
    if (ids.length === 0) continue;
    const details = await getVideoDetails(apiKey, ids);
    budget.spendVideos(Math.ceil(ids.length / 50));
    for (const v of details) {
      v.discovered_query = seed;
      v.discovered_layer = 1;
      videosMap.set(v.video_id, v);
      if (v.channel_id) channelIds.add(v.channel_id);
    }
  }

  const channels = await getChannelDetails(apiKey, [...channelIds]);
  console.log(`[seed] cuota aprox usada: ${budget.units}u (${budget.searches} busquedas).`);
  return { videos: [...videosMap.values()], channels };
}

function gatherFromFixtures() {
  console.log("[seed] YOUTUBE_API_KEY no encontrado -> usando fixtures locales.");
  const channels = FIXTURE_CHANNELS.map((c) => ({
    ...c,
    authority_score: Math.min(1, Math.log10((c.subscriber_count || 0) + 1) / 6),
    updated_at: new Date().toISOString(),
  }));
  return { videos: FIXTURE_VIDEOS.map((v) => ({ ...v })), channels };
}

function buildSQL(videos, channels) {
  const settings = { ...DEFAULTS };
  const channelsById = Object.fromEntries(channels.map((c) => [c.channel_id, c]));
  const lines = [];

  // SEEDS en la cola (capa 1, pending) para que /api/crawl pueda continuar.
  for (const q of DEFAULTS.SEEDS) {
    lines.push(
      `INSERT OR IGNORE INTO search_queue (query, layer, source, status) VALUES (${sqlStr(
        q
      )}, 1, 'seed', 'pending');`
    );
  }

  for (const c of channels) {
    lines.push(
      `INSERT INTO channels (channel_id, title, subscriber_count, authority_score, updated_at) VALUES (${sqlStr(
        c.channel_id
      )}, ${sqlStr(c.title)}, ${sqlStr(c.subscriber_count)}, ${sqlStr(
        c.authority_score ?? Math.min(1, Math.log10((c.subscriber_count || 0) + 1) / 6)
      )}, ${sqlStr(c.updated_at || new Date().toISOString())})
      ON CONFLICT(channel_id) DO UPDATE SET subscriber_count=excluded.subscriber_count, authority_score=excluded.authority_score, updated_at=excluded.updated_at;`
    );
  }

  for (const v of videos) {
    const { score } = scoreVideo(v, settings, channelsById);
    lines.push(
      `INSERT OR IGNORE INTO videos (video_id, title, channel_id, channel_title, description, published_at, duration_seconds, view_count, like_count, comment_count, has_captions, has_chapters, thumbnail_url, url, score_base, discovered_query, discovered_layer) VALUES (${sqlStr(
        v.video_id
      )}, ${sqlStr(v.title)}, ${sqlStr(v.channel_id)}, ${sqlStr(
        v.channel_title
      )}, ${sqlStr(v.description)}, ${sqlStr(v.published_at)}, ${sqlStr(
        v.duration_seconds
      )}, ${sqlStr(v.view_count)}, ${sqlStr(v.like_count)}, ${sqlStr(
        v.comment_count
      )}, ${sqlStr(v.has_captions)}, ${sqlStr(v.has_chapters)}, ${sqlStr(
        v.thumbnail_url
      )}, ${sqlStr(v.url)}, ${sqlStr(score)}, ${sqlStr(
        v.discovered_query
      )}, ${sqlStr(v.discovered_layer || 1)});`
    );
  }

  return lines.join("\n");
}

async function main() {
  const apiKey = loadApiKey();
  const { videos, channels } = apiKey
    ? await gatherFromYouTube(apiKey)
    : gatherFromFixtures();

  if (videos.length === 0) {
    console.error("[seed] No se obtuvieron videos. Aborto.");
    process.exit(1);
  }

  const sql = buildSQL(videos, channels);
  const outFile = join(__dirname, ".seed.generated.sql");
  writeFileSync(outFile, sql, "utf8");
  console.log(`[seed] ${videos.length} videos / ${channels.length} canales -> ${outFile}`);

  console.log(`[seed] Aplicando a D1 (${target})...`);
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB_NAME, target, `--file=${outFile}`, "--yes"],
    { stdio: "inherit", cwd: join(__dirname, "..") }
  );
  console.log("[seed] Listo. Abre la app y veras el corpus inicial.");
}

main().catch((e) => {
  console.error("[seed] Error:", e);
  process.exit(1);
});
