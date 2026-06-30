/**
 * config.js – Valores por defecto globales.
 * Todos son tuneable por usuario vía Firestore (weights, seeds, keywords).
 * El Worker recibe los valores del cliente; aquí sólo están los defaults.
 */

// Semillas de búsqueda por defecto (ES + EN)
export const SEEDS_DEFAULT = [
  // Español
  'generación de leads B2B estrategia',
  'CRM ventas SaaS tutorial',
  'marketing educativo embudo conversión',
  'copywriting ventas persuasión framework',
  'liderazgo productividad sistemas',
  'desarrollo personal hábitos alta performance',
  'ventas consultivas B2B proceso',
  'automatización marketing digital',
  // Inglés
  'B2B lead generation strategy masterclass',
  'SaaS sales framework deep dive',
  'content marketing strategy case study',
  'personal productivity system guide',
  'copywriting sales psychology webinar',
  'leadership management framework',
  'digital marketing funnel strategy',
  'growth hacking B2B case study',
];

// Keywords que indican contenido de profundidad (depth score)
export const DEPTH_KEYWORDS = [
  'masterclass', 'framework', 'caso de estudio', 'case study',
  'webinar', 'estrategia', 'strategy', 'guía', 'guide',
  'deep dive', 'sistema', 'system', 'proceso', 'process',
  'paso a paso', 'step by step', 'completo', 'complete',
  'avanzado', 'advanced', 'tutorial completo', 'full tutorial',
];

// Pesos por defecto (deben sumar 100)
export const WEIGHTS_DEFAULT = {
  engagement: 35,   // ratio like/view, comment/view — no vistas absolutas
  relevance:  25,   // overlap keywords usuario con título/desc
  depth:      15,   // DEPTH_KEYWORDS + capítulos/timestamps
  duration:   10,   // sweet spot 8-60 min, decae fuera
  captions:    5,   // contentDetails.caption == true
  authority:  10,   // log(suscriptores), capeado, no dominante
};

// Rango de duración sweet spot (segundos)
export const DURATION_SWEET = [480, 3600];   // 8 min – 60 min
export const MIN_DURATION   = 300;            // 5 min mínimo absoluto

// Presupuesto de cuota YouTube por ronda
export const BUDGET = {
  max_search_per_round: 10,   // search.list = 100 unidades c/u → 1000 u máx
  daily_limit: 9_000,         // deja margen del total de 10,000
};

// Paginación
export const PAGE_SIZE = 20;
export const CORPUS_FETCH_LIMIT = 300; // videos a traer de D1 antes de re-rankear
