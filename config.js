// config.js
// DEFAULTS del algoritmo. TODO esto es EDITABLE desde la UI (panel "Algoritmo")
// y se persiste en la tabla `settings` de D1. Estos valores solo se usan cuando
// settings esta vacio o cuando el usuario pulsa "Restaurar defaults".

export const DEFAULTS = {
  // Semillas de busqueda (ES + EN). El crawler las encola en la capa 0.
  SEEDS: [
    "generacion de leads",
    "lead generation",
    "CRM para escuelas",
    "CRM for schools",
    "ventas B2B SaaS",
    "B2B SaaS sales",
    "marketing educativo",
    "education marketing",
    "conversion de inscripciones",
    "enrollment conversion",
    "desarrollo personal",
    "personal development",
    "productividad",
    "productivity",
    "copywriting",
    "liderazgo",
    "leadership",
    "negociacion",
    "negotiation",
  ],

  // Vacio al inicio: el usuario las agrega desde la UI. Suben el score (relevance).
  INTEREST_KEYWORDS: [],

  // Palabras/temas que penalizan FUERTE el score (pueden mandar el video al fondo).
  HATE_KEYWORDS: [],

  // Senales de profundidad/densidad de contenido.
  DEPTH_KEYWORDS: [
    "masterclass",
    "framework",
    "caso de estudio",
    "case study",
    "webinar",
    "estrategia",
    "strategy",
    "guia",
    "guide",
    "deep dive",
    "sistema",
    "system",
    "proceso",
    "process",
  ],

  // Pesos del score (suman 100, editables con sliders).
  WEIGHTS: {
    engagement: 35,
    relevance: 25,
    depth: 15,
    duration: 10,
    captions: 5,
    authority: 10,
  },

  // Duracion (segundos). Sweet spot 8-60 min; minimo 5 min.
  DURATION_SWEET: [480, 3600],
  MIN_DURATION: 300,

  // Presupuesto de cuota por ronda de crawl.
  BUDGET: {
    max_search_per_round: 12,
  },

  // Modo por defecto de la UI.
  DEFAULT_MODE: "joyas",
};

export default DEFAULTS;
