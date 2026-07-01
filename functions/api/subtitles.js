/**
 * GET /api/subtitles?videoId=xxx&title=xxx
 * Descarga los subtítulos del video como .txt.
 *
 * Caché compartida (KV):
 *   transcript:VIDEO_ID → texto crudo del transcript
 *   Si otro usuario ya generó esto, se sirve al instante sin tocar YouTube.
 *
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
  const { request, env } = context;
  const params  = new URL(request.url).searchParams;
  const videoId = params.get('videoId') ?? '';
  const title   = params.get('title')   ?? videoId;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
    return new Response('videoId inválido', { status: 400, headers: CORS });

  const filename = sanitizeFilename(title) + '.txt';
  const ytUrl    = `https://www.youtube.com/watch?v=${videoId}`;

  // ── 1. Caché compartida de transcript ─────────────────────────────────────
  const transcriptKey = `transcript:${videoId}`;
  let transcript = await env.CACHE.get(transcriptKey);

  if (!transcript) {
    // ── 2. Intentar timedtext (captions ASR) ──────────────────────────────
    transcript = await fetchTranscript(videoId);
    if (transcript && transcript.length > 150) {
      // Guardar en caché para futuros requests (sinopsis, script, otros usuarios)
      await env.CACHE.put(transcriptKey, transcript);
    } else {
      transcript = null;
    }
  }

  if (transcript) {
    const body = `${title}\n${ytUrl}\n\n${'─'.repeat(60)}\n\n${transcript}`;
    return txtResponse(body, filename);
  }

  return new Response(
    JSON.stringify({ error: 'Este video no tiene subtítulos disponibles.' }),
    { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

function txtResponse(body, filename) {
  return new Response(body, {
    headers: {
      ...CORS,
      'Content-Type':        'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^\w\s\-áéíóúÁÉÍÓÚñÑ]/g, '').trim().slice(0, 80) || 'subtitulos';
}

async function fetchTranscript(videoId) {
  const langs = ['es', 'es-419', 'es-MX', 'en', 'en-US'];
  for (const lang of langs) {
    for (const kind of ['', '&kind=asr']) {
      try {
        const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kind}&fmt=vtt`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' },
        });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length < 80 || text.startsWith('<!')) continue;
        return parseSubtitles(text);
      } catch { continue; }
    }
  }
  return null;
}

async function fetchDescription(apiKey, videoId) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.snippet?.description ?? null;
  } catch { return null; }
}

function parseSubtitles(raw) {
  if (raw.includes('WEBVTT') || raw.includes('-->')) {
    return raw
      .split('\n')
      .filter(l => !l.includes('-->') && !l.match(/^\d+$/) && !l.startsWith('WEBVTT') && l.trim())
      .map(l => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return (raw.match(/<text[^>]*>([\s\S]*?)<\/text>/g) ?? [])
    .map(t =>
      t.replace(/<text[^>]*>/, '').replace('</text>', '')
       .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/<[^>]+>/g, '').trim()
    )
    .filter(Boolean)
    .join(' ');
}
