/**
 * POST /api/synopsis
 * Genera un resumen de 3 párrafos usando subtítulos o descripción.
 *
 * Caché compartida (KV):
 *   synopsis:VIDEO_ID    → texto de la sinopsis generada
 *   transcript:VIDEO_ID  → transcript crudo (compartido con /api/subtitles y /api/script)
 *   description:VIDEO_ID → descripción de YouTube (compartida)
 *
 * RLR · EYE·181218
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { videoId, title = '' } = await request.json().catch(() => ({}));
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      return jsonError('videoId inválido', 400);

    // ── 1. Caché de sinopsis ya generada ──────────────────────────────────────
    const synopsisKey = `synopsis:${videoId}`;
    const cached = await env.CACHE.get(synopsisKey);
    if (cached) return jsonOk({ synopsis: cached, source: 'caché', cached: true });

    // ── 2. Obtener transcript (caché compartida primero) ──────────────────────
    const transcriptKey = `transcript:${videoId}`;
    let transcript = await env.CACHE.get(transcriptKey);
    if (!transcript) {
      transcript = await fetchTranscript(videoId);
      if (transcript && transcript.length > 150)
        await env.CACHE.put(transcriptKey, transcript);
      else
        transcript = null;
    }

    let sourceText  = '';
    let sourceLabel = '';

    if (transcript && transcript.length > 150) {
      sourceText  = sampleText(transcript, 10_000);
      sourceLabel = 'subtítulos del video';
    } else {
      // ── 3. Fallback: descripción (caché compartida primero) ────────────────
      const apiKey = env.YOUTUBE_API_KEY;
      if (!apiKey)
        return jsonOk({ synopsis: null, error: 'Sin subtítulos disponibles y sin API key configurada.' });

      const descKey = `description:${videoId}`;
      let desc = await env.CACHE.get(descKey);
      if (!desc) {
        desc = await fetchDescription(apiKey, videoId);
        if (desc && desc.length > 50) await env.CACHE.put(descKey, desc);
      }
      if (!desc || desc.length < 50)
        return jsonOk({ synopsis: null, error: 'Este video no tiene suficiente información disponible.' });

      sourceText  = sampleText(desc, 6_000);
      sourceLabel = 'descripción del video';
    }

    // ── 4. Generar resumen con Workers AI ────────────────────────────────────
    const prompt = `Información del video "${title}" (fuente: ${sourceLabel}):

---
${sourceText}
---

Escribe un resumen en ESPAÑOL con exactamente 3 párrafos separados por línea en blanco.
REGLAS ESTRICTAS:
- Sin "Párrafo 1:", sin numeración, sin encabezados de ningún tipo.
- Cada párrafo empieza con su IDEA CLAVE en negrita así: **idea clave** seguida del desarrollo.
- Párrafo 1: premisa central del video.
- Párrafo 2: puntos, frameworks o tácticas concretas que se explican.
- Párrafo 3: por qué vale la pena verlo completo.
Máximo 90 palabras por párrafo. Responde SOLO los 3 párrafos, nada más.`;

    for (const model of [
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.1',
    ]) {
      try {
        const res = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'Eres un curador de contenido educativo. Respondes en español con párrafos útiles y concretos. Sin encabezados.' },
            { role: 'user',   content: prompt },
          ],
          max_tokens:  700,
          temperature: 0.4,
        });
        const synopsis = (res?.response ?? '').trim();
        if (synopsis.length > 80) {
          // Guardar en caché para todos los usuarios futuros
          await env.CACHE.put(synopsisKey, synopsis);
          return jsonOk({ synopsis, source: sourceLabel });
        }
      } catch { continue; }
    }

    return jsonOk({ synopsis: null, error: 'No se pudo generar el resumen. Intenta de nuevo.' });

  } catch (err) {
    return jsonError(err.message, 500);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────────

async function fetchTranscript(videoId) {
  const langs = ['es', 'es-419', 'es-MX', 'en', 'en-US', 'en-GB'];
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

function sampleText(text, maxChars) {
  if (text.length <= maxChars) return text;
  const third = Math.floor(maxChars / 3);
  const mid   = Math.floor(text.length / 2);
  return [
    text.slice(0, third),
    text.slice(mid - Math.floor(third / 2), mid + Math.floor(third / 2)),
    text.slice(-third),
  ].join('\n\n[...]\n\n');
}

function jsonOk(d)       { return new Response(JSON.stringify(d),            { headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(m, s) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } }); }
