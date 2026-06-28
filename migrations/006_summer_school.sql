-- Summer school enrollment fields. Only relevant when program = 'Summer School'.
ALTER TABLE students ADD COLUMN ss_weeks TEXT;  -- comma-separated: "1", "1,2", "1,2,3"
ALTER TABLE students ADD COLUMN ss_type  TEXT;  -- "internal" or "external"
