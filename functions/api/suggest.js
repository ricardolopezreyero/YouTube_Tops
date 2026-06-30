/**
 * POST /api/suggest
 * Auth-protected. Recibe {keywords: []} y devuelve {suggestions: []}
 * usando Workers AI para proponer temas relacionados que el usuario no mencionó.
 */

import { requireAuth } from '../../src/lib/auth.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await requireAuth(request, env);
    const body     = await request.json().catch(() => ({}));
    const keywords = Array.isArray(body.keywords) ? body.keywords : [];

    if (!keywords.length) return jsonOk({ suggestions: [] });

    const prompt = `El usuario tiene estos intereses en YouTube: ${keywords.join(', ')}.
Sugiere 6-8 temas ADICIONALES específicos que le darían diversidad y profundidad, pero que probablemente no mencionó.
Sé concreto (ej: "negociación avanzada", "unit economics", "storytelling comercial").
Responde ÚNICAMENTE con JSON array: ["tema1", "tema2"]. Sin texto extra.`;

    const res = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Eres un experto en aprendizaje y content curation. Solo respondes JSON arrays de strings.' },
        { role: 'user',   content: prompt },
      ],
      max_tokens: 250,
      temperature: 0.6,
    });

    const text  = res?.response || '';
    const match = text.match(/\[[\s\S]*?\]/);
    let suggestions = [];
    if (match) {
      try {
        suggestions = JSON.parse(match[0])
          .filter(s => typeof s === 'string' && s.trim())
          .map(s => s.trim().toLowerCase())
          .filter(s => !keywords.map(k => k.toLowerCase()).includes(s))
          .slice(0, 8);
      } catch {}
    }

    return jsonOk({ suggestions });
  } catch (err) {
    return jsonError(err.message, isAuthError(err) ? 401 : 500);
  }
}

function jsonOk(d)          { return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(m, s=500){ return new Response(JSON.stringify({ error: m }), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } }); }
function isAuthError(e)     { const m = e.message.toLowerCase(); return m.includes('token') || m.includes('authorization') || m.includes('expirado'); }
