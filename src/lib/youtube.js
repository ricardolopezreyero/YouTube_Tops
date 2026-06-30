/**
 * youtube.js – Cliente para YouTube Data API v3.
 * Funciones puras: reciben apiKey, devuelven datos crudos de YouTube.
 */

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

export async function searchVideos(apiKey, query, maxResults = 10) {
  const params = new URLSearchParams({
    key: apiKey, q: query, type: 'video', part: 'snippet',
    order: 'relevance', maxResults: String(Math.min(maxResults, 50)),
  });
  const res = await fetch(`${YT_BASE}/search?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`YouTube search.list falló (${res.status}): ${JSON.stringify(err?.error?.message || '')}`);
  }
  return (await res.json()).items || [];
}

export async function enrichVideos(apiKey, videoIds) {
  if (!videoIds.length) return [];
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch  = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({
      key: apiKey, id: batch.join(','),
      part: 'statistics,contentDetails,snippet',
    });
    const res = await fetch(`${YT_BASE}/videos?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`YouTube videos.list falló (${res.status}): ${JSON.stringify(err?.error?.message || '')}`);
    }
    results.push(...((await res.json()).items || []));
  }
  return results;
}

export async function enrichChannels(apiKey, channelIds) {
  const unique = [...new Set(channelIds.filter(Boolean))];
  if (!unique.length) return [];
  const results = [];
  for (let i = 0; i < unique.length; i += 50) {
    const batch  = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      key: apiKey, id: batch.join(','), part: 'snippet,statistics',
    });
    const res = await fetch(`${YT_BASE}/channels?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`YouTube channels.list falló (${res.status}): ${JSON.stringify(err?.error?.message || '')}`);
    }
    results.push(...((await res.json()).items || []));
  }
  return results;
}

export function parseDuration(isoDuration) {
  if (!isoDuration) return 0;
  const m = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

export function detectChapters(description) {
  if (!description) return false;
  return /(?:^|\n)\s*\d{1,2}:\d{2}(?::\d{2})?/.test(description);
}

export function estimateQuota({ searches, videoCount, channelCount }) {
  return searches * 100 + Math.ceil(videoCount / 50) + Math.ceil(channelCount / 50);
}

export function formatVideo(item, channelMap, query, scoreBase = 0) {
  const s  = item.snippet        || {};
  const st = item.statistics     || {};
  const cd = item.contentDetails || {};
  const ch = channelMap[s.channelId || ''] || {};

  return {
    video_id:         item.id,
    title:            s.title            || '',
    channel_id:       s.channelId        || '',
    channel_title:    s.channelTitle     || '',
    description:      (s.description    || '').slice(0, 2000),
    published_at:     s.publishedAt      || '',
    duration_seconds: parseDuration(cd.duration),
    view_count:       parseInt(st.viewCount    || 0),
    like_count:       parseInt(st.likeCount    || 0),
    comment_count:    parseInt(st.commentCount || 0),
    has_captions:     cd.caption === 'true' ? 1 : 0,
    has_chapters:     detectChapters(s.description) ? 1 : 0,
    thumbnail_url:    s.thumbnails?.high?.url || s.thumbnails?.default?.url || '',
    url:              `https://www.youtube.com/watch?v=${item.id}`,
    score_base:       scoreBase,
    discovered_query: query,
    discovered_layer: 1,
  };
}

export function formatChannel(item) {
  const st          = item.statistics || {};
  const subscribers = parseInt(st.subscriberCount || 0);
  return {
    channel_id:       item.id,
    title:            item.snippet?.title || '',
    subscriber_count: subscribers,
    authority_score:  Math.min(1, Math.log10(subscribers + 1) / 7),
  };
}
