-- Date-anchored weeks: when set, the week covers start_date .. start_date+6,
-- letting programs like Summer School span month boundaries and skip holiday
-- weeks. NULL keeps the existing ceil(dayOfMonth/7) mapping.
ALTER TABLE curriculum_weeks ADD COLUMN start_date TEXT;  -- "YYYY-MM-DD" (Monday)

-- Daily sub-theme within a week (Summer School): a title and target vocab.
CREATE TABLE IF NOT EXISTS week_days (
  id          TEXT PRIMARY KEY,
  week_id     TEXT NOT NULL,     -- curriculum_weeks.id
  date        TEXT NOT NULL,     -- "YYYY-MM-DD"
  subtheme    TEXT,              -- e.g. "Pirates"
  vocab       TEXT,              -- target vocab, comma/newline separated
  author      TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (week_id, date)
);
CREATE INDEX IF NOT EXISTS idx_week_days_week ON week_days (week_id, date);
