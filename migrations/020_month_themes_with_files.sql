-- 020: reunite the months that were being planned in the Library.
--
-- 019 deliberately left alone any row with attachments, because Curriculum had
-- no way to render a file. It can now, so the last reason to keep a month theme
-- in the Library is gone.
--
-- After School's year had been split straight down the middle by that gap:
-- May, June, July, November and December were themes, while March, August,
-- September and October lived in the Library purely because someone attached
-- photos to them.
--
-- The rule, stated so it does not depend on this particular data: a row with a
-- program and a month, where that program+month has no theme already, IS that
-- month's theme. A genuine library resource either has no program/month or sits
-- alongside a theme that already owns the slot.

UPDATE lessons SET kind = 'theme'
WHERE kind = 'lesson'
  AND COALESCE(program, '') != ''
  AND COALESCE(month, '')   != ''
  AND NOT EXISTS (
    SELECT 1 FROM lessons t
    WHERE t.kind = 'theme'
      AND t.program = lessons.program
      AND CAST(t.month AS TEXT) = CAST(lessons.month AS TEXT)
  );
