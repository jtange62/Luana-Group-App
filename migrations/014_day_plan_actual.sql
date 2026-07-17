-- Per-day planning on a time block: what's planned for this specific date
-- (day-to-day variation on the weekly plan) and what was actually covered —
-- lessons rarely go exactly as planned. Existing note rows are unaffected.
ALTER TABLE day_block_notes ADD COLUMN planned TEXT;  -- plan for this date
ALTER TABLE day_block_notes ADD COLUMN actual  TEXT;  -- what was actually done/covered
