/**
 * GET /api/download?videoId=xxx
 * Devuelve la URL directa del stream MP4 de mayor calidad disponible
 * usando el cliente ANDROID de InnerTube (sin auth, sin cookies).
 * El cliente descarga directamente desde YouTube — cero ancho de banda del Worker.
 * RLR · EYE·181218
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet(context) {
  const { request } = context;
  const videoId = new URL(request.url).searchParams.get('videoId') ?? '';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
    return jsonError('videoId inválido', 400);

  try {
    const result = await getBestFormat(videoId);
    if (!result)
      return jsonError('No se encontró formato de descarga para este video.', 404);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    return jsonError(err.message, 500);
  }
}

async function getBestFormat(videoId) {
  // InnerTube ANDROID client — devuelve URLs directas sin cipher en combined formats
  const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type':           'application/json',
      'User-Agent':             'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
      'X-YouTube-Client-Name':  '3',
      'X-YouTube-Client-Version': '17.31.35',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName:       'ANDROID',
          clientVersion:    '17.31.35',
          androidSdkVersion: 30,
          hl: 'es',
          gl: 'MX',
          userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
        },
      },
      videoId,
      params: '8AEB', // highest quality hint
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();

  if (data?.playabilityStatus?.status === 'UNPLAYABLE' ||
      data?.playabilityStatus?.status === 'LOGIN_REQUIRED')
    return null;

  // combined formats (video + audio en el mismo archivo) — itag 22 = 720p, 18 = 360p
  const combined = (data?.streamingData?.formats ?? [])
    .filter(f => f.url && f.mimeType?.startsWith('video/mp4'))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (combined.length) {
    const best = combined[0];
    return {
      url:     best.url,
      quality: best.qualityLabel || best.quality || 'HD',
      itag:    best.itag,
    };
  }

  // Fallback: adaptive video-only mp4 (sin audio — peor experiencia pero algo es algo)
  const adaptive = (data?.streamingData?.adaptiveFormats ?? [])
    .filter(f => f.url && f.mimeType?.startsWith('video/mp4') && !f.audioChannels)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (adaptive.length) {
    const best = adaptive[0];
    return {
      url:     best.url,
      quality: (best.qualityLabel || best.quality || 'video') + ' (sin audio)',
      itag:    best.itag,
    };
  }

  return null;
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
