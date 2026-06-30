// functions/api/saved/order.js
// PUT /api/saved/order -> recibe { order: [video_id, ...] } (nuevo orden) y
// reescribe la columna position. Persiste el drag-and-drop de la tab "Para ver despues".

import { json, badRequest, serverError } from "../../../src/lib/http.js";

export async function onRequestPut(context) {
  try {
    const DB = context.env.DB;
    let body;
    try {
      body = await context.request.json();
    } catch {
      return badRequest("JSON invalido");
    }
    const order = body && Array.isArray(body.order) ? body.order : null;
    if (!order) return badRequest("falta order (array de video_id)");

    const stmts = order.map((videoId, idx) =>
      DB.prepare(`UPDATE saved_videos SET position = ?1 WHERE video_id = ?2`).bind(
        idx,
        videoId
      )
    );
    if (stmts.length > 0) {
      await DB.batch(stmts);
    }
    return json({ reordered: true, count: order.length });
  } catch (e) {
    return serverError(e);
  }
}
