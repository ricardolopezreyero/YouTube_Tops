// functions/api/saved.js
// GET    /api/saved              -> lista "Para ver despues" ordenada por position.
// POST   /api/saved              -> guarda un video {video_id, note?}.
// DELETE /api/saved?video_id=... -> quita un video de la lista.

import { json, badRequest, serverError } from "../../src/lib/http.js";

export async function onRequestGet(context) {
  try {
    const DB = context.env.DB;
    // Join con videos para devolver datos completos de la tarjeta.
    const res = await DB.prepare(
      `SELECT s.video_id, s.position, s.note, s.saved_at,
              v.title, v.channel_title, v.duration_seconds, v.view_count,
              v.thumbnail_url, v.url
       FROM saved_videos s
       LEFT JOIN videos v ON v.video_id = s.video_id
       ORDER BY s.position ASC, s.saved_at ASC`
    ).all();
    return json({ items: (res && res.results) || [] });
  } catch (e) {
    return serverError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const DB = context.env.DB;
    let body;
    try {
      body = await context.request.json();
    } catch {
      return badRequest("JSON invalido");
    }
    if (!body || !body.video_id) return badRequest("falta video_id");

    // Nueva posicion = al final.
    const maxRow = await DB.prepare(
      `SELECT COALESCE(MAX(position), -1) AS maxpos FROM saved_videos`
    ).first();
    const nextPos = ((maxRow && maxRow.maxpos) ?? -1) + 1;

    await DB.prepare(
      `INSERT INTO saved_videos (video_id, position, note)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(video_id) DO UPDATE SET note = excluded.note`
    )
      .bind(body.video_id, nextPos, body.note || null)
      .run();

    return json({ saved: true, video_id: body.video_id });
  } catch (e) {
    return serverError(e);
  }
}

export async function onRequestDelete(context) {
  try {
    const DB = context.env.DB;
    const url = new URL(context.request.url);
    const videoId = url.searchParams.get("video_id");
    if (!videoId) return badRequest("falta video_id");
    await DB.prepare(`DELETE FROM saved_videos WHERE video_id = ?1`)
      .bind(videoId)
      .run();
    return json({ deleted: true, video_id: videoId });
  } catch (e) {
    return serverError(e);
  }
}
