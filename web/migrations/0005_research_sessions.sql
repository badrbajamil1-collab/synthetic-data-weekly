CREATE TABLE IF NOT EXISTS research_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  mode         TEXT NOT NULL CHECK (mode IN ('query', 'weekly')),
  query        TEXT NOT NULL,
  days         INTEGER NOT NULL DEFAULT 7,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  current_node TEXT NOT NULL,
  stats_json   TEXT NOT NULL DEFAULT '{}',
  result_json  TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_sessions_created ON research_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_sessions_user ON research_sessions (user_id, created_at DESC);
