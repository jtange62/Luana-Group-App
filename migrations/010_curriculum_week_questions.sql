-- Focus questions on a weekly plan. One or more questions the team wants to
-- centre a week around (After School program in the UI). Optional free text,
-- one question per line — existing weeks are unaffected.
ALTER TABLE curriculum_weeks ADD COLUMN questions TEXT;  -- focus questions for the week
