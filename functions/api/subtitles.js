/**
 * GET /api/subtitles?videoId=xxx&title=xxx
 * GET /api/subtitles?videoId=xxx&check=true   ← polling de job largo
 *
 * Flujo:
 *   1. KV cache (transcript:VIDEO_ID)
 *   2. YouTube timedtext (captions nativas, gratis)
 *   3. Supadata AI (Whisper) — fallback cuando no hay captions
 *      - Videos cortos (<20 min): responde directo (200)
 *      - Videos largos: responde con jobId (202), cliente hace polling
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
  const check   = params.get('check')   === 'true';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
    return jsonError('videoId inválido', 400);

  const filename      = sanitizeFilename(title) + '.txt';
  const ytUrl         = `https://www.youtube.com/watch?v=${videoId}`;
  const transcriptKey = `transcript:${videoId}`;
  const jobKey        = `supadata-job:${videoId}`;

  // ── Polling: cliente verifica si el job largo ya terminó ─────────────────
  if (check) {
    const jobId = await env.CACHE.get(jobKey);
    if (!jobId) return jsonError('Job no encontrado o expirado.', 404);

    const transcript = await pollSupadataJob(jobId, env.SUPADATA_API_KEY);
    if (transcript) {
      await env.CACHE.put(transcriptKey, transcript);
      await env.CACHE.delete(jobKey);
      return txtResponse(`${title}\n${ytUrl}\n\n${'─'.repeat(60)}\n\n${transcript}`, filename);
    }
    // Aún procesando
    return new Response(JSON.stringify({ generating: true }), {
      status: 202, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── 1. Caché KV ───────────────────────────────────────────────────────────
  let transcript = await env.CACHE.get(transcriptKey);
  if (transcript) {
    return txtResponse(`${title}\n${ytUrl}\n\n${'─'.repeat(60)}\n\n${transcript}`, filename);
  }

  // ── 2. YouTube timedtext (captions nativas, sin costo) ───────────────────
  transcript = await fetchTimedtext(videoId);
  if (transcript && transcript.length > 150) {
    await env.CACHE.put(transcriptKey, transcript);
    return txtResponse(`${title}\n${ytUrl}\n\n${'─'.repeat(60)}\n\n${transcript}`, filename);
  }

  // ── 3. Supadata AI (Whisper) ──────────────────────────────────────────────
  const supaKey = env.SUPADATA_API_KEY;
  if (!supaKey) {
    return jsonError('Este video no tiene subtítulos disponibles.', 404);
  }

  try {
    const supaRes = await fetch(
      `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(ytUrl)}&mode=auto&text=true`,
      { headers: { 'x-api-key': supaKey } }
    );

    // Video corto o ya tiene captions: Supadata responde directo
    if (supaRes.status === 200) {
      const data       = await supaRes.json();
      const transcript = extractText(data);
      if (transcript.length > 100) {
        await env.CACHE.put(transcriptKey, transcript);
        return txtResponse(`${title}\n${ytUrl}\n\n${'─'.repeat(60)}\n\n${transcript}`, filename);
      }
      return jsonError('Transcripción vacía o insuficiente.', 404);
    }

    // Video largo: Supadata genera en background → devolver jobId al cliente
    if (supaRes.status === 202) {
      const { jobId } = await supaRes.json();
      await env.CACHE.put(jobKey, jobId, { expirationTtl: 3600 });
      return new Response(JSON.stringify({ generating: true, videoId }), {
        status: 202, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return jsonError('Este video no tiene subtítulos disponibles.', 404);

  } catch (err) {
    return jsonError(`Error al generar transcripción: ${err.message}`, 500);
  }
}

// ── Consulta el job asíncrono de Supadata (un solo intento) ──────────────────
async function pollSupadataJob(jobId, apiKey) {
  try {
    const res = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
      headers: { 'x-api-key': apiKey },
    });
    if (res.status !== 200) return null;
    const data = await res.json();
    const text = extractText(data);
    return text.length > 100 ? text : null;
  } catch { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(data) {
  if (typeof data.content === 'string') return data.content.trim();
  if (Array.isArray(data.content)) return data.content.map(c => c.text || '').join(' ').trim();
  return '';
}

function txtResponse(body, filename) {
  return new Response(body, {
    headers: {
      ...CORS,
      'Content-Type':        'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^\w\s\-áéíóúÁÉÍÓÚñÑ]/g, '').trim().slice(0, 80) || 'subtitulos';
}

async function fetchTimedtext(videoId) {
  const langs = ['es', 'es-419', 'es-MX', 'en', 'en-US'];
  for (const lang of langs) {
    for (const kind of ['', '&kind=asr']) {
      try {
        const res = await fetch(
          `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kind}&fmt=vtt`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' } }
        );
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length < 80 || text.startsWith('<!')) continue;
        return parseVtt(text);
      } catch { continue; }
    }
  }
  return null;
}

function parseVtt(raw) {
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
