-- ─────────────────────────────────────────────────────────────────────────────
-- YouTube Tops – Esquema inicial D1
-- El MVP usa: videos, channels, quota_log
-- Las tablas search_queue y subtitle_ratings son infraestructura para fases TODO
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS videos (
  video_id         TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  channel_id       TEXT,
  channel_title    TEXT,
  description      TEXT,
  published_at     TEXT,
  duration_seconds INTEGER,
  view_count       INTEGER DEFAULT 0,
  like_count       INTEGER DEFAULT 0,
  comment_count    INTEGER DEFAULT 0,
  has_captions     INTEGER DEFAULT 0,   -- 1 = true
  has_chapters     INTEGER DEFAULT 0,   -- 1 = descripción tiene timestamps
  thumbnail_url    TEXT,
  url              TEXT,
  score_base       REAL DEFAULT 0,      -- score con WEIGHTS_DEFAULT
  discovered_query TEXT,
  discovered_layer INTEGER DEFAULT 1,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  channel_id       TEXT PRIMARY KEY,
  title            TEXT,
  subscriber_count INTEGER DEFAULT 0,
  authority_score  REAL DEFAULT 0,
  updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

-- TODO: usado en fase crawler (profundidad 3 capas)
CREATE TABLE IF NOT EXISTS search_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT UNIQUE NOT NULL,
  layer        INTEGER DEFAULT 1,
  source       TEXT,
  status       TEXT DEFAULT 'pending',
  processed_at TEXT
);

-- TODO: usado en fase densidad por subtítulos
CREATE TABLE IF NOT EXISTS subtitle_ratings (
  video_id          TEXT PRIMARY KEY,
  transcript_status TEXT,
  density_score     INTEGER,
  verdict           TEXT,
  model_used        TEXT,
  rated_at          TEXT
);

CREATE TABLE IF NOT EXISTS quota_log (
  day               TEXT PRIMARY KEY,
  search_units_used INTEGER DEFAULT 0
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_videos_score   ON videos(score_base DESC);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_queue_status   ON search_queue(status, layer);
