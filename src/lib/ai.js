/**
 * ai.js – Integración con Cloudflare Workers AI.
 * Deriva seeds y keywords del perfil textual del usuario.
 *
 * Modelo preferido: @cf/meta/llama-3.1-8b-instruct
 * Fallback: @cf/mistral/mistral-7b-instruct-v0.1
 */

const PREFERRED_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const FALLBACK_MODEL  = '@cf/mistral/mistral-7b-instruct-v0.1';

const SYSTEM_PROMPT = `Eres un experto en content curation de YouTube.
Dado el perfil de un usuario, extrae exactamente dos listas:
1. "seeds": 6-10 términos de búsqueda en YouTube (mezcla español e inglés, concretos y específicos)
2. "keywords": 10-20 palabras o frases clave de interés para filtrar contenido relevante

REGLAS ESTRICTAS:
- Responde ÚNICAMENTE con JSON válido. Sin texto antes ni después. Sin markdown.
- Formato exacto: {"seeds": ["...", "..."], "keywords": ["...", "..."]}
- seeds: frases de búsqueda de YouTube (2-5 palabras c/u), no palabras sueltas
- keywords: términos para filtrar contenido (1-3 palabras c/u)`;

/**
 * Llama a Workers AI y devuelve el texto generado.
 * Intenta con el modelo preferido; si falla, usa fallback.
 */
async function callAI(ai, model, description) {
  return ai.run(model, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Perfil del usuario:\n${description}` },
    ],
    max_tokens: 512,
    temperature: 0.3,
  });
}

/**
 * Deriva seeds y keywords a partir de la descripción del usuario.
 * @param {object} ai          - Binding AI de Cloudflare Workers
 * @param {string} description - Texto libre del usuario
 * @returns {{ seeds: string[], keywords: string[] }}
 */
export async function deriveProfile(ai, description) {
  if (!description || description.trim().length < 10) {
    throw new Error('La descripción es demasiado corta para derivar un perfil');
  }

  let responseText = '';

  try {
    const res = await callAI(ai, PREFERRED_MODEL, description);
    responseText = res?.response || res?.result?.response || '';
  } catch (err) {
    // Fallback al modelo alternativo
    console.warn(`Modelo principal falló (${err.message}), usando fallback`);
    try {
      const res = await callAI(ai, FALLBACK_MODEL, description);
      responseText = res?.response || res?.result?.response || '';
    } catch (fallbackErr) {
      throw new Error(`Workers AI no disponible: ${fallbackErr.message}`);
    }
  }

  // Extraer JSON de la respuesta (el modelo a veces añade texto extra)
  const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error('Workers AI no devolvió JSON válido');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('JSON malformado en respuesta de Workers AI');
  }

  if (!Array.isArray(parsed.seeds) || !Array.isArray(parsed.keywords)) {
    throw new Error('Respuesta de AI incompleta: faltan seeds o keywords');
  }

  return {
    seeds:    parsed.seeds.slice(0, 10).filter(s => typeof s === 'string' && s.trim()),
    keywords: parsed.keywords.slice(0, 20).filter(k => typeof k === 'string' && k.trim()),
  };
}
