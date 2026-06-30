// functions/api/videos.js
// GET /api/videos?mode=joyas|profundidad|frescura|autoridad&offset=0&limit=20
// Lee settings + corpus de D1, aplica score + MMR (segun modo), devuelve una pagina.
// NO llama a YouTube. Indica low_on_corpus cuando el corpus se esta agotando.

import { json, serverError } from "../../src/lib/http.js";
import { getSettings } from "../../src/lib/settings.js";
import { scoreVideo, passesMinDuration, depthScore, authorityScore } from "../../src/lib/scoring.js";
import { rankMMR } from "../../src/lib/mmr.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const DB = env.DB;
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "joyas";
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));

    const settings = await getSettings(DB);

    // Carga canales (autoridad).
    const chRes = await DB.prepare(
      `SELECT channel_id, title, subscriber_count, authority_score FROM channels`
    ).all();
    const channelsById = Object.fromEntries(
      ((chRes && chRes.results) || []).map((c) => [c.channel_id, c])
    );

    // Carga corpus completo (single-user: corpus pequeno).
    const vRes = await DB.prepare(`SELECT * FROM videos`).all();
    const corpus = (vRes && vRes.results) || [];

    // Score en vivo segun settings actuales (re-rankea al cambiar el algoritmo).
    let scored = [];
    for (const v of corpus) {
      if (!passesMinDuration(v, settings)) continue;
      const { score, breakdown, excluded } = scoreVideo(v, settings, channelsById);
      if (excluded) continue;
      scored.push({ ...v, score, breakdown });
    }

    // Ordenamiento por modo.
    let ordered;
    if (mode === "frescura") {
      // Frescura NO castiga el score; este modo simplemente prioriza lo reciente.
      ordered = scored.sort((a, b) =>
        String(b.published_at || "").localeCompare(String(a.published_at || ""))
      );
    } else if (mode === "profundidad") {
      ordered = scored.sort(
        (a, b) =>
          depthScore(b, settings.DEPTH_KEYWORDS) - depthScore(a, settings.DEPTH_KEYWORDS) ||
          b.score - a.score
      );
    } else if (mode === "autoridad") {
      ordered = scored.sort(
        (a, b) =>
          authorityScore(b, channelsById) - authorityScore(a, channelsById) ||
          b.score - a.score
      );
    } else {
      // joyas (default): score con diversidad MMR.
      ordered = rankMMR(scored, 0.7);
    }

    const total = ordered.length;
    const page = ordered.slice(offset, offset + limit);
    const remaining = total - (offset + page.length);
    const low_on_corpus = total < 12 || remaining <= 8;

    return json({
      mode,
      offset,
      limit,
      total,
      returned: page.length,
      low_on_corpus,
      items: page,
    });
  } catch (e) {
    return serverError(e);
  }
}
