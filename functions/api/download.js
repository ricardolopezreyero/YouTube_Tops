/**
 * GET /api/download?videoId=xxx
 * Obtiene la URL de descarga del video en máxima calidad via cobalt.tools API.
 * cobalt maneja signature decryption, selección de formato y compatibilidad con YouTube.
 * El Worker solo llama a cobalt y devuelve la URL — el cliente descarga directo
 * desde cobalt/YouTube sin pasar tráfico por nuestros Workers.
 * RLR · EYE·181218
 */

const COBALT_API = 'https://api.cobalt.tools/';

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
    const cobaltRes = await fetch(COBALT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify({
        url:           `https://www.youtube.com/watch?v=${videoId}`,
        videoQuality:  'max',
        filenameStyle: 'basic',
        downloadMode:  'auto',
      }),
    });

    const data = await cobaltRes.json().catch(() => ({}));

    // cobalt devuelve { status: "redirect"|"tunnel"|"picker"|"error", url, filename }
    if (data.status === 'error') {
      const msg = data.error?.code
        ? cobalErrorMsg(data.error.code)
        : 'El video no se puede descargar.';
      return jsonError(msg, 422);
    }

    if (data.status === 'redirect' || data.status === 'tunnel') {
      return jsonOk({ url: data.url, filename: data.filename || `video-${videoId}.mp4` });
    }

    // picker → múltiples calidades (ej. si hay audio/video separados)
    if (data.status === 'picker' && data.picker?.length) {
      const best = data.picker[0]; // primera opción = mayor calidad
      if (best?.url)
        return jsonOk({ url: best.url, filename: data.filename || `video-${videoId}.mp4` });
    }

    return jsonError('Respuesta inesperada del servicio de descarga.', 502);

  } catch (err) {
    return jsonError(`Error al contactar servicio de descarga: ${err.message}`, 500);
  }
}

// ── Mensajes amigables para códigos de error de cobalt ──────────────────────
function cobalErrorMsg(code) {
  const map = {
    'content.video.unavailable': 'El video no está disponible.',
    'content.video.age':         'El video tiene restricción de edad.',
    'content.video.private':     'El video es privado.',
    'content.video.live':        'No se pueden descargar transmisiones en vivo.',
    'fetch.fail':                'No se pudo acceder al video.',
    'fetch.rate':                'Límite de descargas alcanzado, intenta en unos minutos.',
    'service.quota':             'Cuota del servicio de descarga agotada, intenta más tarde.',
  };
  return map[code] ?? `No se pudo descargar (${code}).`;
}

function jsonOk(d)      { return new Response(JSON.stringify(d),            { headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(m,s) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } }); }
