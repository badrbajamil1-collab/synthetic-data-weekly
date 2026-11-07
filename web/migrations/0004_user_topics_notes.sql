-- Per-person follows (topics and sources) and free-text notes on things
-- that are not in a brief yet ("Upcoming" in the library).
CREATE TABLE user_topics (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('topic', 'source')),
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, value)
);

CREATE TABLE user_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_user_notes_user ON user_notes (user_id);
