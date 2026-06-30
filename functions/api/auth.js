// functions/api/auth.js
// Publico (lo deja pasar el middleware). El front lo consulta al cargar para
// saber si debe pedir la contrasena. POST verifica una contrasena propuesta.

import { json } from "../../src/lib/http.js";

export async function onRequestGet(context) {
  return json({ auth_required: !!context.env.APP_PASSWORD });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.APP_PASSWORD) return json({ ok: true, auth_required: false });
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const ok = body && body.password === env.APP_PASSWORD;
  return json({ ok, auth_required: true }, ok ? 200 : 401);
}
