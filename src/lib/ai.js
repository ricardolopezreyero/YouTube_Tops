/**
 * ai.js – Integración con Cloudflare Workers AI.
 * Deriva seeds, keywords y nombres de listas del perfil del usuario.
 */

const PREFERRED_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const FALLBACK_MODEL  = '@cf/mistral/mistral-7b-instruct-v0.1';

const SYSTEM_PROMPT = `Eres un experto en content curation de YouTube.
Dado el perfil de un usuario, extrae exactamente tres elementos:
1. "seeds": 6-10 términos de búsqueda en YouTube (mezcla español e inglés, concretos y específicos)
2. "keywords": 10-20 palabras o frases clave de interés para filtrar contenido relevante
3. "suggested_lists": exactamente 3 nombres de listas de reproducción personalizadas, cortas (2-4 palabras), que reflejen las principales áreas de interés del usuario

REGLAS ESTRICTAS:
- Responde ÚNICAMENTE con JSON válido. Sin texto antes ni después. Sin markdown.
- Formato exacto: {"seeds": ["...", "..."], "keywords": ["...", "..."], "suggested_lists": ["...", "...", "..."]}
- seeds: frases de búsqueda de YouTube (2-5 palabras c/u)
- keywords: términos para filtrar contenido (1-3 palabras c/u)
- suggested_lists: nombres cortos y descriptivos en el idioma del usuario (ej: "Ventas B2B", "Deep Work", "Frameworks Mentales")`;

async function callAI(ai, model, description) {
  return ai.run(model, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Perfil del usuario:\n${description}` },
    ],
    max_tokens: 600,
    temperature: 0.3,
  });
}

/**
 * Deriva seeds, keywords y nombres de listas sugeridas.
 * @param {object} ai          - Binding AI de Cloudflare Workers
 * @param {string} description - Texto libre del usuario
 * @returns {{ seeds: string[], keywords: string[], suggested_lists: string[] }}
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
    console.warn(`Modelo principal falló (${err.message}), usando fallback`);
    try {
      const res = await callAI(ai, FALLBACK_MODEL, description);
      responseText = res?.response || res?.result?.response || '';
    } catch (fallbackErr) {
      throw new Error(`Workers AI no disponible: ${fallbackErr.message}`);
    }
  }

  const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error('Workers AI no devolvió JSON válido');

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { throw new Error('JSON malformado en respuesta de Workers AI'); }

  if (!Array.isArray(parsed.seeds) || !Array.isArray(parsed.keywords)) {
    throw new Error('Respuesta de AI incompleta: faltan seeds o keywords');
  }

  // Fallback de listas si el modelo no las incluyó
  const defaultLists = ['Ver después', 'Favoritos', 'Comparte esto'];
  const suggestedLists = Array.isArray(parsed.suggested_lists) && parsed.suggested_lists.length >= 1
    ? parsed.suggested_lists.slice(0, 3).map(s => String(s).trim()).filter(Boolean)
    : defaultLists;

  // Completar a 3 si devolvió menos
  while (suggestedLists.length < 3) suggestedLists.push(defaultLists[suggestedLists.length]);

  return {
    seeds:           parsed.seeds.slice(0, 10).filter(s => typeof s === 'string' && s.trim()),
    keywords:        parsed.keywords.slice(0, 20).filter(k => typeof k === 'string' && k.trim()),
    suggested_lists: suggestedLists,
  };
}
