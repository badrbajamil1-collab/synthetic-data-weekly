-- One row per scheduled or manual pipeline invocation.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at);
