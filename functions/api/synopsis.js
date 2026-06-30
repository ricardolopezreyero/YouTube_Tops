/**
 * POST /api/synopsis
 * Descarga los subtítulos de YouTube (sin OAuth) y genera un resumen de 3 párrafos
 * con Workers AI. Solo se llama al hacer clic — no hay pre-generación.
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

    // ── 1. Obtener página del video para encontrar caption tracks ─────────────
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      },
    });
    if (!pageRes.ok) return jsonError('No se pudo acceder al video de YouTube', 502);
    const html = await pageRes.text();

    // ── 2. Extraer captionTracks del JSON embebido ────────────────────────────
    const tracks = parseCaptionTracks(html);
    if (!tracks || tracks.length === 0)
      return jsonOk({ synopsis: null, error: 'Este video no tiene subtítulos disponibles.' });

    // Preferencia: español → inglés → cualquier idioma
    const preferred = tracks.find(t => t.languageCode?.startsWith('es'))
      || tracks.find(t => t.languageCode?.startsWith('en'))
      || tracks[0];

    if (!preferred?.baseUrl)
      return jsonOk({ synopsis: null, error: 'No se encontraron subtítulos utilizables.' });

    // ── 3. Descargar el XML de subtítulos ─────────────────────────────────────
    const captionRes = await fetch(preferred.baseUrl);
    if (!captionRes.ok) return jsonError('Error al descargar subtítulos', 502);
    const captionXml = await captionRes.text();

    // ── 4. Parsear XML → texto plano ──────────────────────────────────────────
    const transcript = parseTranscriptXml(captionXml);
    if (transcript.length < 100)
      return jsonOk({ synopsis: null, error: 'Los subtítulos están vacíos o son muy cortos.' });

    // Muestra representativa: inicio + medio + final (para videos largos)
    const chunk = sampleTranscript(transcript, 11_000);

    // ── 5. Resumir con Workers AI ──────────────────────────────────────────────
    const lang  = preferred.languageCode?.startsWith('es') ? 'español' : 'español (traducido del inglés)';
    const prompt = `Transcript del video "${title}" (idioma original: ${lang}):

---
${chunk}
---

Escribe un resumen en 3 párrafos en ESPAÑOL. NO uses encabezados ni numeración.
- Párrafo 1: De qué trata el video y cuál es la premisa principal.
- Párrafo 2: Los puntos clave, frameworks o tácticas que se explican.
- Párrafo 3: Qué se aprende y por qué vale la pena verlo completo.

Sé concreto, denso en información y útil. Máximo 120 palabras por párrafo.`;

    const models = ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1'];
    let synopsis = '';

    for (const model of models) {
      try {
        const res = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'Eres un experto en síntesis de contenido. Respondes en español con párrafos densos y útiles.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 700,
          temperature: 0.45,
        });
        const raw = (res?.response || '').trim();
        if (raw.length > 80) { synopsis = raw; break; }
      } catch { continue; }
    }

    if (!synopsis)
      return jsonOk({ synopsis: null, error: 'No se pudo generar la sinopsis. Intenta de nuevo.' });

    return jsonOk({ synopsis, lang: preferred.languageCode });

  } catch (err) {
    return jsonError(err.message, 500);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCaptionTracks(html) {
  try {
    const idx = html.indexOf('"captionTracks":');
    if (idx === -1) return null;
    const arrStart = html.indexOf('[', idx);
    let depth = 0, end = arrStart;
    for (; end < html.length; end++) {
      if (html[end] === '[') depth++;
      else if (html[end] === ']') { depth--; if (depth === 0) break; }
    }
    return JSON.parse(html.slice(arrStart, end + 1));
  } catch { return null; }
}

function parseTranscriptXml(xml) {
  return (xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [])
    .map(tag => {
      const inner = tag.replace(/<text[^>]*>/, '').replace('</text>', '');
      return inner
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, '').trim();
    })
    .filter(Boolean)
    .join(' ');
}

function sampleTranscript(text, maxChars) {
  if (text.length <= maxChars) return text;
  const third = Math.floor(maxChars / 3);
  const mid   = Math.floor(text.length / 2);
  return [
    text.slice(0, third),
    text.slice(mid - Math.floor(third / 2), mid + Math.floor(third / 2)),
    text.slice(text.length - third),
  ].join('\n\n[...]\n\n');
}

function jsonOk(data)          { return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(msg, s=500) { return new Response(JSON.stringify({ error: msg }), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } }); }
