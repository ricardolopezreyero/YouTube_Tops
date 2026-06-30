// functions/api/settings.js
// GET  /api/settings        -> devuelve el algoritmo actual (DEFAULTS + persistido).
// PUT  /api/settings        -> guarda el algoritmo editado.
// DELETE /api/settings      -> "Restaurar defaults".

import { json, badRequest, serverError } from "../../src/lib/http.js";
import { getSettings, saveSettings, resetSettings } from "../../src/lib/settings.js";

export async function onRequestGet(context) {
  try {
    const settings = await getSettings(context.env.DB);
    return json({ settings });
  } catch (e) {
    return serverError(e);
  }
}

export async function onRequestPut(context) {
  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return badRequest("JSON invalido");
    }
    const incoming = body && body.settings ? body.settings : body;
    const settings = await saveSettings(context.env.DB, incoming);
    return json({ settings, saved: true });
  } catch (e) {
    return serverError(e);
  }
}

export async function onRequestDelete(context) {
  try {
    const settings = await resetSettings(context.env.DB);
    return json({ settings, reset: true });
  } catch (e) {
    return serverError(e);
  }
}
