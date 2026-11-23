-- Track signed-in accounts' username and weekly email subscription state.
-- First sign-in subscribes the account automatically (email_subscribed = 1);
-- users can pause/resume without being silently re-subscribed on later visits.
ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN email_subscribed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN subscribed_at TEXT;

UPDATE users
  SET subscribed_at = COALESCE(subscribed_at, created_at)
  WHERE email_subscribed = 1 AND subscribed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_subscribed ON users (email_subscribed, email);
