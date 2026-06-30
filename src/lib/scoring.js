// src/lib/scoring.js
// Calcula un score 0-100 por video usando los pesos/keywords de `settings`.
// Filosofia: premiar densidad y engagement RELATIVO (no vistas absolutas),
// para saltarse el algoritmo de retencion y descubrir "joyas".
// La frescura NO castiga. HATE_KEYWORDS penaliza fuerte.

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos
}

function countMatches(haystack, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  const h = normalize(haystack);
  let hits = 0;
  for (const kw of keywords) {
    const k = normalize(kw);
    if (k && h.includes(k)) hits += 1;
  }
  return hits;
}

// --- Sub-scores (cada uno 0..1) ---

// engagement: ratios like/view y comment/view. Penaliza ultra-viral con engagement pobre.
export function engagementScore(v) {
  const views = Math.max(1, v.view_count || 0);
  const likeRatio = (v.like_count || 0) / views;
  const commentRatio = (v.comment_count || 0) / views;
  // Buenos videos suelen tener like/view ~2-6% y comment/view ~0.1-0.5%.
  const likePart = clamp(likeRatio / 0.05); // 5% -> tope
  const commentPart = clamp(commentRatio / 0.004); // 0.4% -> tope
  let s = 0.7 * likePart + 0.3 * commentPart;
  // Penaliza ultra-viral (muchas vistas) con engagement pobre.
  if ((v.view_count || 0) > 1_000_000 && likeRatio < 0.01) s *= 0.5;
  return clamp(s);
}

// relevance: overlap de INTEREST_KEYWORDS con titulo/descripcion.
export function relevanceScore(v, interestKeywords) {
  if (!interestKeywords || interestKeywords.length === 0) return 0.5; // neutro si no hay intereses definidos
  const text = `${v.title || ""} ${v.description || ""}`;
  const hits = countMatches(text, interestKeywords);
  return clamp(hits / Math.min(4, interestKeywords.length));
}

// depth: DEPTH_KEYWORDS + capitulos/timestamps en la descripcion.
export function depthScore(v, depthKeywords) {
  const text = `${v.title || ""} ${v.description || ""}`;
  const kwHits = countMatches(text, depthKeywords);
  const kwPart = clamp(kwHits / 3);
  const chaptersPart = v.has_chapters ? 1 : 0;
  return clamp(0.6 * kwPart + 0.4 * chaptersPart);
}

// duration: completo dentro del sweet spot, decae fuera.
export function durationScore(v, sweet) {
  const [lo, hi] = sweet || [480, 3600];
  const d = v.duration_seconds || 0;
  if (d <= 0) return 0.3;
  if (d >= lo && d <= hi) return 1;
  if (d < lo) return clamp(d / lo);
  // por encima del tope, decae suave
  return clamp(hi / d);
}

// captions: contentDetails.caption == true.
export function captionsScore(v) {
  return v.has_captions ? 1 : 0;
}

// authority: log de suscriptores, capeado, NO dominante.
export function authorityScore(v, channelsById) {
  const ch = channelsById ? channelsById[v.channel_id] : null;
  const subs = (ch && ch.subscriber_count) || 0;
  if (subs <= 0) return 0.3;
  // log10 capeado a 1M subs.
  return clamp(Math.log10(subs + 1) / 6); // 10^6 -> 1.0
}

// Penalizacion por HATE_KEYWORDS (0..1, 1 = sin penalizar).
function hatePenalty(v, hateKeywords) {
  const text = `${v.title || ""} ${v.description || ""}`;
  const hits = countMatches(text, hateKeywords);
  if (hits <= 0) return { factor: 1, excluded: false };
  // 1 hit -> *0.4, 2 -> *0.16, 3+ -> excluir.
  if (hits >= 3) return { factor: 0, excluded: true };
  return { factor: Math.pow(0.4, hits), excluded: false };
}

// Devuelve { score (0-100), breakdown, excluded } para el boton "ver por que".
export function scoreVideo(v, settings, channelsById) {
  const w = settings.WEIGHTS || {};
  const totalW =
    (w.engagement || 0) +
    (w.relevance || 0) +
    (w.depth || 0) +
    (w.duration || 0) +
    (w.captions || 0) +
    (w.authority || 0) || 1;

  const subs = {
    engagement: engagementScore(v),
    relevance: relevanceScore(v, settings.INTEREST_KEYWORDS),
    depth: depthScore(v, settings.DEPTH_KEYWORDS),
    duration: durationScore(v, settings.DURATION_SWEET),
    captions: captionsScore(v),
    authority: authorityScore(v, channelsById),
  };

  let weighted = 0;
  const breakdown = {};
  for (const key of Object.keys(subs)) {
    const contribution = (subs[key] * (w[key] || 0)) / totalW; // 0..1 proporcion del peso
    breakdown[key] = {
      sub: Math.round(subs[key] * 100),
      weight: w[key] || 0,
      points: Math.round(subs[key] * (w[key] || 0)), // puntos sobre el peso
    };
    weighted += subs[key] * (w[key] || 0);
  }

  const raw = (weighted / totalW) * 100; // 0..100
  const { factor, excluded } = hatePenalty(v, settings.HATE_KEYWORDS);
  const score = Math.round(raw * factor);

  return { score, breakdown, excluded, hate_factor: factor };
}

// Aplica el filtro de duracion minima de settings.
export function passesMinDuration(v, settings) {
  const min = settings.MIN_DURATION || 0;
  return (v.duration_seconds || 0) >= min;
}
