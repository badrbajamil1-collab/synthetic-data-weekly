-- Signed-in people (identity comes from Cloudflare Access; id is the email).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Private per-person state for a paper: read later, important, notes.
CREATE TABLE IF NOT EXISTS user_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  read_later INTEGER NOT NULL DEFAULT 0,
  important INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_items_user ON user_items(user_id);
