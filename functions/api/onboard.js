/**
 * POST /api/onboard
 * Auth-protected. Recibe {description} → Workers AI → devuelve {seeds, keywords, suggested_lists}.
 */

import { requireAuth } from '../../src/lib/auth.js';
import { deriveProfile } from '../../src/lib/ai.js';

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
    const user = await requireAuth(request, env);

    let body;
    try { body = await request.json(); }
    catch { return jsonError('Cuerpo no es JSON válido', 400); }

    const description = (body?.description || '').trim();
    if (description.length < 20)
      return jsonError('La descripción debe tener al menos 20 caracteres', 400);

    const profile = await deriveProfile(env.AI, description);

    return jsonOk({ uid: user.sub, ...profile });
  } catch (err) {
    return jsonError(err.message, isAuthError(err) ? 401 : 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } });
}
function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function isAuthError(err) {
  const m = err.message.toLowerCase();
  return m.includes('token') || m.includes('authorization') || m.includes('expirado') || m.includes('ausente');
}
