-- 018: the today-first direction.
--
-- 1. Split curriculum themes from library lessons. Both tools wrote the same
--    `lessons` table with nothing to tell them apart, and Curriculum picked a
--    month's theme as "the most recent lessons row for this program + month" —
--    so a lesson plan filed in the Library under Preschool / July silently
--    became the July Preschool theme.
--
-- 2. A per-day usage counter, so "is anyone actually using this?" has an
--    answer that doesn't need Cloudflare dashboard access.

ALTER TABLE lessons ADD COLUMN kind TEXT NOT NULL DEFAULT 'lesson';

-- Backfill. The two forms write disjoint fields: the Library writes
-- notes/link/tags/files, Curriculum writes song/vocab/activities/phonics. So a
-- row is a theme if a curriculum week hangs off it, or it carries any
-- theme-only field.
--
-- Edge case: a theme saved with a title and nothing else stays 'lesson' and
-- will show up in the Library instead of Curriculum. To move one back:
--   UPDATE lessons SET kind = 'theme' WHERE id = '<id>';
UPDATE lessons SET kind = 'theme'
WHERE id IN (SELECT DISTINCT lesson_id FROM curriculum_weeks)
   OR COALESCE(song, '')       != ''
   OR COALESCE(vocab, '')      != ''
   OR COALESCE(activities, '') != ''
   OR COALESCE(phonics, '')    != '';

CREATE INDEX IF NOT EXISTS idx_lessons_kind ON lessons (kind, program, month);

-- One row per tool per day. Written fire-and-forget on page open; nothing here
-- identifies a person, only that the tool was opened.
CREATE TABLE IF NOT EXISTS usage_daily (
  day   TEXT NOT NULL,              -- "YYYY-MM-DD" (UTC)
  tool  TEXT NOT NULL,              -- today|tools|calendar|curriculum|ideas|library|students|website
  hits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tool)
);
