-- Daily rhythm for the Curriculum tool. Each program has ONE reusable
-- template of time blocks (same every weekday). Blocks auto-fill from the
-- month theme / week plan via `source`; only one-off per-date notes are
-- stored per day (day_block_notes).
CREATE TABLE IF NOT EXISTS schedule_blocks (
  id          TEXT PRIMARY KEY,
  program     TEXT NOT NULL,     -- Preschool|Kinder|After School|Summer School
  start_time  TEXT NOT NULL,     -- "HH:MM" (also the sort key)
  end_time    TEXT,              -- optional "HH:MM"
  label       TEXT NOT NULL,     -- e.g. "Circle Time"
  source      TEXT,              -- week_focus|week_activities|week_phonics|week_questions|month_theme|month_song|month_vocab|month_activities|month_phonics; NULL = label only
  author      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_program ON schedule_blocks (program, start_time);

-- One-off note a teacher pins to a block on a specific date.
CREATE TABLE IF NOT EXISTS day_block_notes (
  id          TEXT PRIMARY KEY,
  block_id    TEXT NOT NULL,
  date        TEXT NOT NULL,     -- "YYYY-MM-DD"
  text        TEXT NOT NULL,
  author      TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (block_id, date)
);
CREATE INDEX IF NOT EXISTS idx_day_block_notes_date ON day_block_notes (block_id, date);
