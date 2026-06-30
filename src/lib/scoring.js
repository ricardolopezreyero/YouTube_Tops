/**
 * scoring.js – Re-ranking del corpus según el perfil del usuario.
 * Función pura: no accede a BD ni red.
 *
 * Cada componente devuelve un valor normalizado [0, 1].
 * El score final es la suma ponderada de los componentes.
 */

import { WEIGHTS_DEFAULT, DEPTH_KEYWORDS, DURATION_SWEET, MIN_DURATION } from '../../config.js';

// ── Componentes individuales ──────────────────────────────────────────────────

function engagementScore(video) {
  const views    = video.view_count    || 0;
  const likes    = video.like_count    || 0;
  const comments = video.comment_count || 0;

  if (views === 0) return 0;

  const likeRatio    = likes    / views;
  const commentRatio = comments / views;

  // Benchmarks calibrados: 4% likes = alto, 0.3% comentarios = alto
  let score = Math.min(1, likeRatio / 0.04) * 0.65
            + Math.min(1, commentRatio / 0.003) * 0.35;

  // Penaliza ultra-virales con engagement pobre (clickbait masivo)
  if (views > 5_000_000 && score < 0.25) score *= 0.5;

  return Math.min(1, score);
}

function relevanceScore(video, keywords) {
  if (!keywords || keywords.length === 0) return 0.5;

  const text = `${video.title} ${video.description || ''}`.toLowerCase();
  const hits  = keywords.filter(kw => kw && text.includes(kw.toLowerCase())).length;

  const threshold = Math.max(1, Math.ceil(keywords.length * 0.3));
  return Math.min(1, hits / threshold);
}

function depthScore(video) {
  const text     = `${video.title} ${video.description || ''}`.toLowerCase();
  const hits     = DEPTH_KEYWORDS.filter(kw => text.includes(kw.toLowerCase())).length;
  const chapters = video.has_chapters === 1;
  return Math.min(1, hits / 3) * 0.7 + (chapters ? 1 : 0) * 0.3;
}

function durationScore(video) {
  const dur = video.duration_seconds || 0;
  if (dur < MIN_DURATION) return 0;
  if (dur >= DURATION_SWEET[0] && dur <= DURATION_SWEET[1]) return 1.0;
  if (dur < DURATION_SWEET[0])
    return (dur - MIN_DURATION) / (DURATION_SWEET[0] - MIN_DURATION);
  return Math.max(0, 1 - (dur - DURATION_SWEET[1]) / DURATION_SWEET[1]);
}

function captionsScore(video) {
  return video.has_captions === 1 ? 1 : 0;
}

function authorityScore(channel) {
  const subscribers = channel?.subscriber_count || 0;
  return Math.min(1, Math.log10(subscribers + 1) / 7);
}

// ── Función principal ─────────────────────────────────────────────────────────

export function scoreVideo(video, channelData, userWeights = {}, userKeywords = []) {
  const weights = { ...WEIGHTS_DEFAULT, ...userWeights };
  const totalW  = Object.values(weights).reduce((a, b) => a + b, 0) || 100;
  const nw      = {};
  for (const k of Object.keys(weights)) nw[k] = weights[k] / totalW;

  const components = {
    engagement: engagementScore(video),
    relevance:  relevanceScore(video, userKeywords),
    depth:      depthScore(video),
    duration:   durationScore(video),
    captions:   captionsScore(video),
    authority:  authorityScore(channelData),
  };

  const total =
    nw.engagement * components.engagement +
    nw.relevance  * components.relevance  +
    nw.depth      * components.depth      +
    nw.duration   * components.duration   +
    nw.captions   * components.captions   +
    nw.authority  * components.authority;

  return {
    total:      Math.round(total      * 1000) / 1000,
    components: {
      engagement: Math.round(components.engagement * 100) / 100,
      relevance:  Math.round(components.relevance  * 100) / 100,
      depth:      Math.round(components.depth      * 100) / 100,
      duration:   Math.round(components.duration   * 100) / 100,
      captions:   components.captions,
      authority:  Math.round(components.authority  * 100) / 100,
    },
  };
}

export function scoreBase(video, channelData) {
  return scoreVideo(video, channelData, WEIGHTS_DEFAULT, []).total;
}
