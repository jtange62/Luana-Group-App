-- One-time trial visits. Not linked to the students roster.
CREATE TABLE IF NOT EXISTS trials (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  program    TEXT NOT NULL,
  date       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trials_date ON trials (date);
