// src/lib/mmr.js
// Acomodo optimo con diversidad (Maximal Marginal Relevance).
// Ordena por score pero evita repetir el mismo canal/subtema seguido,
// para que cada video aporte algo distinto. La joya #1 (mayor score) va arriba.

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Conjunto de tokens significativos del titulo (para similitud de subtema).
function tokens(v) {
  const text = normalize(`${v.title || ""}`);
  const stop = new Set([
    "the", "and", "for", "with", "que", "para", "con", "los", "las", "una",
    "del", "como", "how", "you", "your", "this", "that", "de", "la", "el",
    "en", "un", "a", "to", "of", "in", "is",
  ]);
  return new Set(
    text
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !stop.has(t))
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// Similitud entre dos videos: fuerte si mismo canal, ademas solape de subtema.
function similarity(a, b, ta, tb) {
  const sameChannel = a.channel_id && a.channel_id === b.channel_id ? 1 : 0;
  return Math.max(sameChannel, jaccard(ta, tb));
}

// items: [{ ...video, score }]. lambda: 0..1 (1 = solo score, 0 = solo diversidad).
export function rankMMR(items, lambda = 0.7) {
  const pool = [...items];
  if (pool.length <= 1) return pool;

  const tokCache = new Map();
  const tk = (v) => {
    if (!tokCache.has(v.video_id)) tokCache.set(v.video_id, tokens(v));
    return tokCache.get(v.video_id);
  };

  const maxScore = Math.max(1, ...pool.map((p) => p.score || 0));
  const selected = [];

  // Arranca con la joya #1 (mayor score).
  pool.sort((a, b) => (b.score || 0) - (a.score || 0));
  selected.push(pool.shift());

  while (pool.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      const rel = (cand.score || 0) / maxScore;
      let maxSim = 0;
      const tc = tk(cand);
      for (const s of selected) {
        const sim = similarity(cand, s, tc, tk(s));
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * rel - (1 - lambda) * maxSim;
      if (mmr > bestVal) {
        bestVal = mmr;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]);
  }

  return selected;
}
