/**
 * POST /api/script
 * Genera un artículo completo y bien redactado a partir de los subtítulos del video.
 * NO es una sinopsis: es la reescritura completa del contenido, con secciones y negritas.
 *
 * Caché compartida (KV):
 *   script:VIDEO_ID      → markdown del artículo generado
 *   transcript:VIDEO_ID  → transcript crudo (compartido con /api/subtitles y /api/synopsis)
 *   description:VIDEO_ID → descripción de YouTube (compartida)
 *
 * Retorna { script, source } donde script tiene formato markdown.
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

    // ── 1. Caché del script ya generado ───────────────────────────────────────
    const scriptKey = `script:${videoId}`;
    const cached = await env.CACHE.get(scriptKey);
    if (cached) return jsonOk({ script: cached, source: 'caché', cached: true });

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

    if (transcript && transcript.length > 300) {
      sourceText  = sampleText(transcript, 16_000);
      sourceLabel = 'subtítulos';
    } else {
      // ── 3. Fallback: descripción (caché compartida primero) ────────────────
      const apiKey = env.YOUTUBE_API_KEY;
      if (!apiKey) return jsonOk({ script: null, error: 'Sin subtítulos ni API key configurada.' });

      const descKey = `description:${videoId}`;
      let desc = await env.CACHE.get(descKey);
      if (!desc) {
        desc = await fetchDescription(apiKey, videoId);
        if (desc && desc.length > 50) await env.CACHE.put(descKey, desc);
      }
      if (!desc || desc.length < 80)
        return jsonOk({ script: null, error: 'No hay suficiente contenido para generar el script.' });

      sourceText  = sampleText(desc, 8_000);
      sourceLabel = 'descripción';
    }

    // ── 4. Workers AI — redactor profesional ─────────────────────────────────
    const prompt = buildPrompt(title, sourceText, sourceLabel);

    const models = [
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.1',
    ];
    let lastErr = '';
    for (const model of models) {
      try {
        const res = await env.AI.run(model, {
          messages: [
            {
              role: 'system',
              content:
                'Eres un editor profesional de contenido educativo en español. ' +
                'Recibes transcripciones de videos y las conviertes en artículos bien redactados, ' +
                'concisos y estructurados. Nunca escribes meta-comentarios sobre tu tarea.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens:  2000,
          temperature: 0.3,
        });

        const script = (res?.response ?? '').trim();
        if (script.length > 200) {
          await env.CACHE.put(scriptKey, script);
          return jsonOk({ script, source: sourceLabel });
        }
        lastErr = `Respuesta demasiado corta del modelo (${script.length} chars)`;
      } catch (e) {
        lastErr = e?.message ?? String(e);
        // Pequeña pausa entre reintentos para evitar rate-limit back-to-back
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
    }

    return jsonOk({ script: null, error: `No se pudo generar el script: ${lastErr}` });

  } catch (err) {
    return jsonError(err.message, 500);
  }
}

// ── Prompt ─────────────────────────────────────────────────────────────────────
function buildPrompt(title, text, source) {
  return `Fuente: ${source} del video "${title}"

---
${text}
---

TAREA: Convierte este contenido en un artículo profesional en ESPAÑOL.

ESTRUCTURA OBLIGATORIA:
1. Párrafo de introducción: captura la idea central y el valor del video (3-4 oraciones)
2. Secciones temáticas con subtítulos (usa ## para cada sección)
3. Sección final: ## Puntos clave — lista de 4-6 aprendizajes directos con viñetas (-)

REGLAS DE ESCRITURA:
- Los conceptos importantes, cifras, herramientas, nombres y recomendaciones van en **negrita**
- Voz activa, oraciones directas, sin muletillas del habla ("o sea", "básicamente", "tipo")
- Conserva TODAS las ideas, ejemplos, números y recomendaciones del contenido original
- No resumas: quien lea el artículo debe aprender exactamente lo mismo que viendo el video
- Sin frases introductorias como "En este video...", "El autor explica..." — empieza directo
- Máximo 2000 palabras

Responde SOLO el artículo, sin preámbulos ni explicaciones sobre lo que vas a hacer.`;
}

// ── helpers ────────────────────────────────────────────────────────────────────

async function fetchTranscript(videoId) {
  const langs = ['es', 'es-419', 'es-MX', 'en', 'en-US', 'en-GB'];
  for (const lang of langs) {
    for (const kind of ['', '&kind=asr']) {
      try {
        const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${kind}&fmt=vtt`;
        const res = await fetch(url, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (compatible)',
            'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
          },
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
