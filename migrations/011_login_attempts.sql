-- Failed login attempts, for rate limiting the shared password.
-- After too many wrong passwords from one IP, /api/login answers 429 for a while.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip          TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (ip, created_at);
