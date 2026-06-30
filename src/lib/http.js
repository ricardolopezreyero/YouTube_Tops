// src/lib/http.js
// Helpers de respuesta JSON para las Pages Functions.

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function badRequest(msg) {
  return json({ error: msg || "Bad request" }, 400);
}

export function serverError(e) {
  return json({ error: String((e && e.message) || e) }, 500);
}
