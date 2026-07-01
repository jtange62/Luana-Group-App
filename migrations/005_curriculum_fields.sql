-- Structured curriculum fields on lesson-library themes. A theme (one per
-- program per month) now also carries the month's vocab, activities, phonics
-- focus, and song. All optional, so the existing library/calendar flows are
-- unaffected — the Curriculum overview tool is what reads/writes these.
ALTER TABLE lessons ADD COLUMN vocab      TEXT;  -- theme vocabulary words
ALTER TABLE lessons ADD COLUMN activities TEXT;  -- theme / weekly activities
ALTER TABLE lessons ADD COLUMN phonics    TEXT;  -- phonics focus for the month
ALTER TABLE lessons ADD COLUMN song       TEXT;  -- song of the month
