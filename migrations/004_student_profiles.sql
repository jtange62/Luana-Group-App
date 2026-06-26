-- Add profile fields to the student roster. Age is computed from birthday,
-- not stored. All fields optional so the existing attendance flow is unaffected.
ALTER TABLE students ADD COLUMN birthday   TEXT;   -- "YYYY-MM-DD"
ALTER TABLE students ADD COLUMN guardian   TEXT;   -- parent / guardian name
ALTER TABLE students ADD COLUMN phone      TEXT;
ALTER TABLE students ADD COLUMN email      TEXT;
ALTER TABLE students ADD COLUMN allergies  TEXT;   -- allergies / medical notes
ALTER TABLE students ADD COLUMN emergency  TEXT;   -- emergency contact
ALTER TABLE students ADD COLUMN notes      TEXT;
ALTER TABLE students ADD COLUMN enrolled_at TEXT;  -- "YYYY-MM-DD" start date
