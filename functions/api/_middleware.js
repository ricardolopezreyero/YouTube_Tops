// functions/api/_middleware.js
// Auth opcional para TODOS los endpoints /api/*.
// Si APP_PASSWORD esta definido (Cloudflare Secret), el front debe enviar el
// header `X-App-Password`. Si NO esta definido, la app queda abierta.

import { json } from "../../src/lib/http.js";

export async function onRequest(context) {
  const { request, env, next } = context;

  // CORS/preflight (mismo origen en Pages, pero por si acaso).
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-app-password",
      },
    });
  }

  // /api/auth es publico: el front lo usa para saber si debe pedir contrasena.
  const url = new URL(request.url);
  if (url.pathname === "/api/auth") {
    return next();
  }

  const required = env.APP_PASSWORD;
  if (required) {
    const provided = request.headers.get("x-app-password");
    if (provided !== required) {
      return json({ error: "unauthorized", auth_required: true }, 401);
    }
  }

  return next();
}
