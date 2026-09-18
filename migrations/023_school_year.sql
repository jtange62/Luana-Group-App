-- Existing undated planning records belong to the current 2026 school year.
ALTER TABLE lessons ADD COLUMN school_year INTEGER NOT NULL DEFAULT 2026;
ALTER TABLE students ADD COLUMN school_year INTEGER NOT NULL DEFAULT 2026;
ALTER TABLE students ADD COLUMN source_student_id TEXT;
ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'event';
ALTER TABLE events ADD COLUMN end_date TEXT;
CREATE INDEX idx_lessons_school_year ON lessons(school_year,kind,program,month);
CREATE INDEX idx_students_school_year ON students(school_year,active,program);
CREATE TABLE school_year_copies (school_year INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(school_year,kind));

CREATE TABLE IF NOT EXISTS summer_weeks (school_year INTEGER NOT NULL, id TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, PRIMARY KEY(school_year,id));
INSERT OR IGNORE INTO summer_weeks VALUES (2026,'1','2026-07-27','2026-07-31'),(2026,'2','2026-08-03','2026-08-07'),(2026,'3','2026-08-17','2026-08-21');
