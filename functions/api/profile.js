/**
 * GET/POST /api/profile
 * Perfil único de usuario (single-user app), guardado en Cloudflare KV.
 * Sin auth — mismo perfil visible desde cualquier dispositivo.
 * RLR · EYE·181218
 */

const KV_KEY = 'profile:owner';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const raw = await env.CACHE.get(KV_KEY);
    return jsonOk(raw ? JSON.parse(raw) : {});
  } catch (err) {
    return jsonError(err.message, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try { body = await request.json(); }
    catch { return jsonError('Cuerpo no es JSON válido', 400); }

    await env.CACHE.put(KV_KEY, JSON.stringify(body));
    return jsonOk({ saved: true });
  } catch (err) {
    return jsonError(err.message, 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } });
}
function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
