/**
 * POST /api/onboard
 * Endpoint protegido con Firebase Auth.
 * Recibe { description } → llama a Workers AI → devuelve { seeds, keywords }.
 * El cliente guarda el resultado en Firestore (users/{uid}).
 *
 * Cloudflare Pages Function: /functions/api/onboard.js → ruta /api/onboard
 */

import { requireAuth } from '../../src/lib/auth.js';
import { deriveProfile } from '../../src/lib/ai.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // ── Autenticación ───────────────────────────────────────────────────────
    const user = await requireAuth(request, env);

    // ── Validar cuerpo ──────────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Cuerpo de la petición no es JSON válido', 400);
    }

    const description = (body?.description || '').trim();
    if (description.length < 20) {
      return jsonError('La descripción debe tener al menos 20 caracteres', 400);
    }

    // ── Derivar perfil con Workers AI ───────────────────────────────────────
    const profile = await deriveProfile(env.AI, description);

    return new Response(
      JSON.stringify({
        uid:      user.sub,
        seeds:    profile.seeds,
        keywords: profile.keywords,
      }),
      { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );

  } catch (err) {
    const status = isAuthError(err) ? 401 : 500;
    return jsonError(err.message, status);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(message, status = 500) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
  );
}

function isAuthError(err) {
  const msg = err.message.toLowerCase();
  return msg.includes('token') || msg.includes('authorization') ||
         msg.includes('expirado') || msg.includes('inválido') ||
         msg.includes('ausente');
}
