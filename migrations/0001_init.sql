-- migrations/0001_init.sql
-- Esquema completo. El MVP no usa todas las tablas (subtitle_ratings es fase TODO),
-- pero se crean todas para no migrar de nuevo mas adelante.

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  title TEXT,
  channel_id TEXT,
  channel_title TEXT,
  description TEXT,
  published_at TEXT,
  duration_seconds INTEGER,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  has_captions INTEGER,
  has_chapters INTEGER,
  thumbnail_url TEXT,
  url TEXT,
  score_base REAL,
  discovered_query TEXT,
  discovered_layer INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT,
  subscriber_count INTEGER,
  authority_score REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS search_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT UNIQUE,
  layer INTEGER,
  source TEXT,
  status TEXT DEFAULT 'pending',
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS saved_videos (
  video_id TEXT PRIMARY KEY,
  position INTEGER,
  note TEXT,
  saved_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS subtitle_ratings (
  video_id TEXT PRIMARY KEY,
  transcript_status TEXT,
  density_score INTEGER,
  verdict TEXT,
  model_used TEXT,
  rated_at TEXT
);

CREATE TABLE IF NOT EXISTS quota_log (
  day TEXT PRIMARY KEY,
  search_units_used INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_videos_score ON videos(score_base DESC);
CREATE INDEX IF NOT EXISTS idx_queue_status ON search_queue(status, layer);
CREATE INDEX IF NOT EXISTS idx_saved_pos ON saved_videos(position);
