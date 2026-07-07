-- Teacher retro notes on a curriculum week ("what worked / what didn't").
-- One thread per curriculum_weeks row; any signed-in teacher may delete.
CREATE TABLE IF NOT EXISTS week_comments (
  id          TEXT PRIMARY KEY,
  week_id     TEXT NOT NULL,     -- curriculum_weeks.id
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_week_comments_week ON week_comments (week_id);
