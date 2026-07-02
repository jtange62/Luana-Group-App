-- Weekly breakdown of a monthly curriculum theme. Each row is one week within
-- a theme (a lessons row), zooming in from the month snapshot: a sub-theme
-- focus plus that week's activities, phonics, and notes. Vocab and song stay
-- at the month level on the lessons row.
CREATE TABLE IF NOT EXISTS curriculum_weeks (
  id          TEXT PRIMARY KEY,
  lesson_id   TEXT NOT NULL,    -- the month theme this week belongs to
  week_no     INTEGER NOT NULL, -- 1, 2, 3, … order within the month
  focus       TEXT,             -- sub-theme / focus title for the week
  activities  TEXT,             -- that week's activities
  phonics     TEXT,             -- that week's letters / sounds
  notes       TEXT,             -- free-text reminders
  author      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_curriculum_weeks_lesson ON curriculum_weeks (lesson_id, week_no);
