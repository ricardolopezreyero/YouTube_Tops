/**
 * POST /api/add-video
 * Auth-protected. Recibe {url: "https://youtube.com/watch?v=..."}.
 * 1. Extrae el video_id de la URL.
 * 2. Busca en D1 primero (sin gastar cuota).
 * 3. Si no existe, llama a YouTube videos.list y lo inserta en D1.
 * 4. Devuelve los datos del video listos para mostrar en el cliente.
 */

import { enrichVideos, parseDuration, detectChapters, formatChannel } from '../../src/lib/youtube.js';
import { scoreBase } from '../../src/lib/scoring.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try { body = await request.json(); }
    catch { return jsonError('Cuerpo no es JSON válido', 400); }

    const url     = (body?.url || '').trim();
    const videoId = extractVideoId(url);
    if (!videoId) return jsonError('URL de YouTube no válida', 400);

    // ── Buscar en D1 primero ────────────────────────────────────────────────
    const existing = await env.DB
      .prepare('SELECT v.*, c.subscriber_count FROM videos v LEFT JOIN channels c ON v.channel_id = c.channel_id WHERE v.video_id = ?')
      .bind(videoId).first();

    if (existing) return jsonOk({ video: dbRowToCard(existing), source: 'cache' });

    // ── No está en D1: llamar a YouTube API ─────────────────────────────────
    const apiKey = env.YOUTUBE_API_KEY;
    if (!apiKey) return jsonError('YOUTUBE_API_KEY no configurada', 500);

    const items = await enrichVideos(apiKey, [videoId]);
    if (!items.length) return jsonError('Video no encontrado en YouTube', 404);

    const item = items[0];
    const cd   = item.contentDetails || {};
    const s    = item.snippet        || {};
    const st   = item.statistics     || {};

    let channelData = null;
    if (s.channelId) {
      const chRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?key=${apiKey}&id=${s.channelId}&part=snippet,statistics`
      );
      if (chRes.ok) {
        const chData = await chRes.json();
        if (chData.items?.[0]) channelData = formatChannel(chData.items[0]);
      }
    }

    const durSecs     = parseDuration(cd.duration);
    const hasChapters = detectChapters(s.description);

    const videoRow = {
      video_id:         videoId,
      title:            s.title            || '',
      channel_id:       s.channelId        || '',
      channel_title:    s.channelTitle     || '',
      description:      (s.description    || '').slice(0, 2000),
      published_at:     s.publishedAt      || '',
      duration_seconds: durSecs,
      view_count:       parseInt(st.viewCount    || 0),
      like_count:       parseInt(st.likeCount    || 0),
      comment_count:    parseInt(st.commentCount || 0),
      has_captions:     cd.caption === 'true' ? 1 : 0,
      has_chapters:     hasChapters ? 1 : 0,
      thumbnail_url:    s.thumbnails?.high?.url || s.thumbnails?.default?.url || '',
      url:              `https://www.youtube.com/watch?v=${videoId}`,
      score_base:       scoreBase(
        { ...st, duration_seconds: durSecs, has_captions: cd.caption === 'true' ? 1 : 0, has_chapters: hasChapters ? 1 : 0, title: s.title || '', description: s.description || '' },
        channelData
      ),
      discovered_query: 'manual',
      discovered_layer: 1,
    };

    await env.DB.prepare(`
      INSERT OR REPLACE INTO videos
        (video_id, title, channel_id, channel_title, description, published_at,
         duration_seconds, view_count, like_count, comment_count,
         has_captions, has_chapters, thumbnail_url, url, score_base,
         discovered_query, discovered_layer, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).bind(
      videoRow.video_id, videoRow.title, videoRow.channel_id, videoRow.channel_title,
      videoRow.description, videoRow.published_at, videoRow.duration_seconds,
      videoRow.view_count, videoRow.like_count, videoRow.comment_count,
      videoRow.has_captions, videoRow.has_chapters, videoRow.thumbnail_url,
      videoRow.url, videoRow.score_base, videoRow.discovered_query, videoRow.discovered_layer
    ).run();

    if (channelData) {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO channels (channel_id, title, subscriber_count, authority_score, updated_at)
        VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      `).bind(channelData.channel_id, channelData.title, channelData.subscriber_count, channelData.authority_score).run();
    }

    return jsonOk({ video: dbRowToCard({ ...videoRow, subscriber_count: channelData?.subscriber_count || 0 }), source: 'youtube' });

  } catch (err) {
    return jsonError(err.message, isAuthError(err) ? 401 : 500);
  }
}

function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/v\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}

function dbRowToCard(row) {
  return {
    video_id:      row.video_id,
    title:         row.title,
    channel_title: row.channel_title,
    thumbnail_url: row.thumbnail_url,
    url:           row.url,
    duration_s:    row.duration_seconds,
    view_count:    row.view_count,
    published_at:  row.published_at,
    score:         row.score_base || 0,
    score_base:    row.score_base || 0,
    has_captions:  row.has_captions,
  };
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } });
}
function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function isAuthError(err) {
  const m = err.message.toLowerCase();
  return m.includes('token') || m.includes('authorization') || m.includes('expirado') || m.includes('ausente');
}
