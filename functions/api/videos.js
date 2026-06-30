/**
 * GET /api/videos?offset=0&limit=20&weights=<json>&keywords=<json|csv>
 * Endpoint protegido con Firebase Auth.
 * Consulta el corpus D1, re-rankea con el perfil del usuario y devuelve la página.
 * NO llama a YouTube.
 */

import { scoreVideo } from '../../src/lib/scoring.js';
import { WEIGHTS_DEFAULT, CORPUS_FETCH_LIMIT, PAGE_SIZE } from '../../config.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url    = new URL(request.url);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
    const limit  = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || String(PAGE_SIZE))));

    let weights  = { ...WEIGHTS_DEFAULT };
    let keywords = [];

    const wParam = url.searchParams.get('weights');
    if (wParam) {
      try { weights = { ...weights, ...JSON.parse(wParam) }; } catch {}
    }

    const kParam = url.searchParams.get('keywords');
    if (kParam) {
      try { keywords = JSON.parse(kParam); }
      catch { keywords = kParam.split(',').map(k => k.trim()).filter(Boolean); }
    }

    const { results: videos } = await env.DB.prepare(`
      SELECT
        v.video_id, v.title, v.channel_id, v.channel_title,
        v.description, v.published_at, v.duration_seconds,
        v.view_count, v.like_count, v.comment_count,
        v.has_captions, v.has_chapters,
        v.thumbnail_url, v.url, v.score_base,
        c.subscriber_count, c.authority_score AS channel_authority
      FROM videos v
      LEFT JOIN channels c ON v.channel_id = c.channel_id
      ORDER BY v.score_base DESC
      LIMIT ?
    `).bind(CORPUS_FETCH_LIMIT).all();

    if (!videos || videos.length === 0)
      return jsonOk({ videos: [], total: 0, hasMore: false });

    const scored = videos.map(video => {
      const channelData = { subscriber_count: video.subscriber_count || 0, authority_score: video.channel_authority || 0 };
      const { total, components } = scoreVideo(video, channelData, weights, keywords);
      return {
        video_id:      video.video_id,
        title:         video.title,
        channel_title: video.channel_title,
        thumbnail_url: video.thumbnail_url,
        url:           video.url,
        duration_s:    video.duration_seconds,
        view_count:    video.view_count,
        published_at:  video.published_at,
        score:         total,
        score_base:    video.score_base,
        breakdown:     components,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return jsonOk({
      videos:  scored.slice(offset, offset + limit),
      total:   scored.length,
      hasMore: offset + limit < scored.length,
    });

  } catch (err) {
    return jsonError(err.message, isAuthError(err) ? 401 : 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } });
}
function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function isAuthError(err) {
  const m = err.message.toLowerCase();
  return m.includes('token') || m.includes('authorization') || m.includes('expirado') || m.includes('inválido') || m.includes('ausente');
}
