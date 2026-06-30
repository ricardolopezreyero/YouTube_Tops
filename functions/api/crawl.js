// functions/api/crawl.js
// POST /api/crawl  -> "Cargar mas / Buscar joyas".
// Procesa la siguiente capa pendiente de search_queue dentro del BUDGET,
// enriquece, guarda en D1 y responde cuantos videos nuevos entraron.
// Se llama AUTO cuando low_on_corpus o cuando el usuario toca el boton.

import { json, serverError } from "../../src/lib/http.js";
import { getSettings } from "../../src/lib/settings.js";
import { enqueueSeeds, processNextLayer } from "../../src/lib/crawler.js";

export async function onRequestPost(context) {
  const { env } = context;
  try {
    const DB = env.DB;
    const CACHE = env.CACHE;
    const apiKey = env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return json(
        {
          error: "YOUTUBE_API_KEY no configurado",
          hint: "Configura el secret con `wrangler secret put YOUTUBE_API_KEY` (o en .dev.vars para local).",
          new_videos: 0,
        },
        400
      );
    }

    const settings = await getSettings(DB);

    // Asegura que las SEEDS esten en la cola (idempotente).
    await enqueueSeeds(DB, settings.SEEDS);

    const result = await processNextLayer(DB, CACHE, apiKey, settings);
    return json(result);
  } catch (e) {
    return serverError(e);
  }
}
