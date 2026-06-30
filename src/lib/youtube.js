// src/lib/youtube.js
// Cliente minimo de la YouTube Data API v3.
// Flujo: search.list -> IDs -> videos.list (detalles) -> channels.list (autoridad).
// Cachea respuestas crudas en KV para no re-gastar cuota.

const API = "https://www.googleapis.com/youtube/v3";

// Convierte ISO 8601 (PT#H#M#S) a segundos.
export function parseISODuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

// Detecta capitulos/timestamps en la descripcion (ej. "0:00", "12:34 Intro").
export function hasChapters(description) {
  if (!description) return false;
  const matches = description.match(/(?:^|\n)\s*(\d{1,2}:)?\d{1,2}:\d{2}\b/g);
  return !!matches && matches.length >= 3; // >=3 marcas de tiempo = capitulos
}

async function getJSON(url, { CACHE, cacheKey, cacheTtl } = {}) {
  if (CACHE && cacheKey) {
    const cached = await CACHE.get(cacheKey, "json");
    if (cached) return { ...cached, _cached: true };
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (CACHE && cacheKey) {
    await CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: cacheTtl || 60 * 60 * 24 * 7, // 7 dias
    });
  }
  return data;
}

// search.list -> devuelve array de videoIds (hasta `max`, default 50).
export async function searchVideos(apiKey, query, { CACHE, max = 25, regionAware = true } = {}) {
  const params = new URLSearchParams({
    key: apiKey,
    part: "id",
    q: query,
    type: "video",
    maxResults: String(Math.min(50, max)),
    order: "relevance",
    relevanceLanguage: regionAware ? "es" : "en",
    safeSearch: "none",
  });
  const url = `${API}/search?${params}`;
  const data = await getJSON(url, {
    CACHE,
    cacheKey: `search:${query}`,
    cacheTtl: 60 * 60 * 24, // 1 dia
  });
  return (data.items || [])
    .map((it) => (it.id && it.id.videoId) || null)
    .filter(Boolean);
}

// videos.list por lotes de 50 -> detalles completos.
export async function getVideoDetails(apiKey, videoIds, { CACHE } = {}) {
  const out = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({
      key: apiKey,
      part: "snippet,contentDetails,statistics",
      id: batch.join(","),
      maxResults: "50",
    });
    const data = await getJSON(`${API}/videos?${params}`, {
      CACHE,
      cacheKey: `videos:${batch.join(",")}`,
    });
    for (const it of data.items || []) {
      const sn = it.snippet || {};
      const cd = it.contentDetails || {};
      const st = it.statistics || {};
      const thumbs = sn.thumbnails || {};
      const thumb =
        (thumbs.medium && thumbs.medium.url) ||
        (thumbs.high && thumbs.high.url) ||
        (thumbs.default && thumbs.default.url) ||
        "";
      out.push({
        video_id: it.id,
        title: sn.title || "",
        channel_id: sn.channelId || "",
        channel_title: sn.channelTitle || "",
        description: sn.description || "",
        published_at: sn.publishedAt || "",
        duration_seconds: parseISODuration(cd.duration),
        view_count: parseInt(st.viewCount || "0", 10),
        like_count: parseInt(st.likeCount || "0", 10),
        comment_count: parseInt(st.commentCount || "0", 10),
        has_captions: cd.caption === "true" ? 1 : 0,
        has_chapters: hasChapters(sn.description) ? 1 : 0,
        thumbnail_url: thumb,
        url: `https://www.youtube.com/watch?v=${it.id}`,
      });
    }
  }
  return out;
}

// channels.list por lotes de 50 -> autoridad (suscriptores).
export async function getChannelDetails(apiKey, channelIds, { CACHE } = {}) {
  const out = [];
  const unique = [...new Set(channelIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      key: apiKey,
      part: "snippet,statistics",
      id: batch.join(","),
      maxResults: "50",
    });
    const data = await getJSON(`${API}/channels?${params}`, {
      CACHE,
      cacheKey: `channels:${batch.join(",")}`,
    });
    for (const it of data.items || []) {
      const st = it.statistics || {};
      const subs = parseInt(st.subscriberCount || "0", 10);
      out.push({
        channel_id: it.id,
        title: (it.snippet && it.snippet.title) || "",
        subscriber_count: subs,
        authority_score: Math.min(1, Math.log10(subs + 1) / 6),
        updated_at: new Date().toISOString(),
      });
    }
  }
  return out;
}
