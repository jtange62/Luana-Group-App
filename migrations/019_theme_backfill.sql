-- 019: finish the 018 backfill.
--
-- 018 only recognised a curriculum theme by its theme-only fields (song, vocab,
-- activities, phonics) or by having curriculum weeks hanging off it. Production
-- turned out to hold five themes that were saved with nothing but a title, a
-- program and a month — "Spooky", "Dinosaurs", "Christmas", "Spring",
-- "Summertime!" — which 018 left sitting in the Library.
--
-- A row with a program and a month but no notes, link, tags or files carries
-- nothing the Library can show, so it is a theme. Rows WITH files stay as
-- lessons even when the title looks theme-shaped ("Summer", "Pirates"):
-- Curriculum has no way to display an attachment, so reclassifying those would
-- hide the files. To move one of those across by hand:
--   UPDATE lessons SET kind = 'theme' WHERE id = '<id>';

UPDATE lessons SET kind = 'theme'
WHERE kind = 'lesson'
  AND COALESCE(program, '')   != ''
  AND COALESCE(month, '')     != ''
  AND COALESCE(notes, '')      = ''
  AND COALESCE(link_url, '')   = ''
  AND COALESCE(tags, '')       = ''
  AND NOT EXISTS (SELECT 1 FROM lesson_files f WHERE f.lesson_id = lessons.id);
