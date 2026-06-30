/**
 * POST /api/synopsis
 * Obtiene subtítulos vía InnerTube API (sin OAuth, sin scraping HTML)
 * y genera un resumen de 3 párrafos con Workers AI.
 * RLR · EYE·181218
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// InnerTube context — cliente web estándar
const INNERTUBE_CTX = {
  context: {
    client: {
      clientName:    'WEB',
      clientVersion: '2.20240101.01.00',
      hl:            'es',
      gl:            'MX',
    },
  },
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

    // ── 1. InnerTube player endpoint → caption tracks ─────────────────────────
    const playerRes = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ videoId, ...INNERTUBE_CTX }),
      }
    );

    if (!playerRes.ok)
      return jsonOk({ synopsis: null, error: 'No se pudo consultar la información del video.' });

    const player = await playerRes.json();
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

    // ── 2. Fallback: timedtext list si InnerTube no devolvió tracks ───────────
    let captionUrl = null;
    let captionLang = 'es';

    if (tracks.length > 0) {
      const preferred = tracks.find(t => t.languageCode?.startsWith('es'))
        || tracks.find(t => t.languageCode?.startsWith('en'))
        || tracks[0];
      captionUrl  = preferred.baseUrl;
      captionLang = preferred.languageCode ?? 'es';
    } else {
      // Intentar directamente el endpoint de timedtext
      for (const lang of ['es', 'es-419', 'en', 'en-US']) {
        const testUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`;
        const testRes = await fetch(testUrl);
        if (testRes.ok) {
          const text = await testRes.text();
          if (text.length > 50) { captionUrl = testUrl; captionLang = lang; break; }
        }
      }
    }

    if (!captionUrl)
      return jsonOk({ synopsis: null, error: 'Este video no tiene subtítulos disponibles.' });

    // ── 3. Descargar subtítulos ───────────────────────────────────────────────
    const capRes = await fetch(captionUrl);
    if (!capRes.ok)
      return jsonOk({ synopsis: null, error: 'No se pudieron descargar los subtítulos.' });

    const capText = await capRes.text();

    // ── 4. Parsear XML → texto plano ──────────────────────────────────────────
    const transcript = parseTranscriptXml(capText);
    if (transcript.length < 80)
      return jsonOk({ synopsis: null, error: 'Los subtítulos son demasiado cortos para resumir.' });

    const chunk = sampleTranscript(transcript, 11_000);

    // ── 5. Resumir con Workers AI ─────────────────────────────────────────────
    const langLabel = captionLang.startsWith('es') ? 'español' : 'inglés (traducir al español)';
    const prompt = `Transcript del video "${title}" en ${langLabel}:

---
${chunk}
---

Escribe un resumen en ESPAÑOL con exactamente 3 párrafos. Sin encabezados ni numeración.
Párrafo 1: De qué trata el video y cuál es la premisa central.
Párrafo 2: Los puntos, frameworks o tácticas más concretos.
Párrafo 3: Por qué vale la pena verlo completo y qué se lleva el espectador.
Máximo 100 palabras por párrafo. Sé directo y útil.`;

    for (const model of [
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.1',
    ]) {
      try {
        const res = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'Eres un curador de contenido. Respondes en español con párrafos densos y útiles. Sin encabezados.' },
            { role: 'user',   content: prompt },
          ],
          max_tokens:  700,
          temperature: 0.4,
        });
        const synopsis = (res?.response ?? '').trim();
        if (synopsis.length > 80)
          return jsonOk({ synopsis, lang: captionLang });
      } catch { continue; }
    }

    return jsonOk({ synopsis: null, error: 'No se pudo generar el resumen. Intenta de nuevo.' });

  } catch (err) {
    return jsonError(err.message, 500);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTranscriptXml(xml) {
  return (xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g) ?? [])
    .map(tag =>
      tag.replace(/<text[^>]*>/, '').replace('</text>', '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, '').trim()
    )
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
    text.slice(-third),
  ].join('\n\n[...]\n\n');
}

function jsonOk(d)       { return new Response(JSON.stringify(d),           { headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(m, s) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } }); }
