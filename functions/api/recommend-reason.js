/**
 * POST /api/recommend-reason
 * Genera UNA oración en español explicando por qué el usuario debería ver un video.
 * Usa Workers AI — llama-3.1-8b-instruct con fallback a mistral.
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
    const body = await request.json().catch(() => ({}));
    const { title = '', channel_title = '', duration_s = 0, breakdown = {}, keywords = [] } = body;

    if (!title) return jsonOk({ reason: '' });

    const durMin  = Math.round((duration_s || 0) / 60);
    const kwStr   = keywords.slice(0, 6).join(', ') || 'aprendizaje general';
    const engPct  = Math.round((breakdown.engagement  || 0) * 100);
    const depthPct= Math.round((breakdown.depth       || 0) * 100);
    const relPct  = Math.round((breakdown.relevance   || 0) * 100);

    const prompt = `El usuario está interesado en: ${kwStr}.

Video: "${title}" de ${channel_title}.
Duración: ${durMin} minutos.
Score: engagement ${engPct}/100, profundidad ${depthPct}/100, relevancia para el usuario ${relPct}/100.

Escribe UNA sola oración en español (máximo 20 palabras) que explique por qué ESTE usuario debería ver ESTE video.
- Sé concreto y directo, sin frases genéricas como "muy interesante" o "te ayudará"
- No repitas el título ni el canal
- Menciona algo específico del contenido o de los intereses del usuario
- Responde SOLO la oración, sin comillas, sin prefijos

Oración:`;

    const models = ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1'];
    let reason = '';

    for (const model of models) {
      try {
        const res = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'Eres un curador de contenido. Respondes solo con una oración directa en español.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 80,
          temperature: 0.55,
        });
        const raw = (res?.response || '').trim().replace(/^["']|["']$/g, '').trim();
        if (raw.length > 10 && raw.length < 200) { reason = raw; break; }
      } catch {}
    }

    return jsonOk({ reason });
  } catch (err) {
    return jsonOk({ reason: '' });
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } });
}
