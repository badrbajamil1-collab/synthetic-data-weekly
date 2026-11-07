-- Initial schema for the synthetic-data web archive
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  week_end TEXT NOT NULL,
  subject TEXT NOT NULL,
  trend TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pdf_r2_key TEXT,
  html_r2_key TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  published TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  well7_fit INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  run_at TEXT NOT NULL,
  items_found INTEGER NOT NULL DEFAULT 0,
  duplicates_removed INTEGER NOT NULL DEFAULT 0,
  already_sent INTEGER NOT NULL DEFAULT 0,
  candidates_read INTEGER NOT NULL DEFAULT 0,
  links_checked INTEGER NOT NULL DEFAULT 0,
  links_dead INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_report ON items(report_id);
CREATE INDEX IF NOT EXISTS idx_reports_week ON reports(week_end);