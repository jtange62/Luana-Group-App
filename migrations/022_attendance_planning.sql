
-- A booked visit is separate from the attendance mark made on arrival.
CREATE TABLE IF NOT EXISTS attendance_visits (
  id TEXT PRIMARY KEY,
  student_id TEXT,
  name TEXT NOT NULL,
  program TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('makeup','trial','other')),
  status TEXT NOT NULL DEFAULT '' CHECK(status IN ('','present','absent','late')),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(student_id,date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_visits_date ON attendance_visits(date,program);

-- Preserve pre-existing makeup/trial bookings and their class association.
INSERT OR IGNORE INTO attendance_visits(id,student_id,name,program,date,kind,created_at)
SELECT 'legacy-' || a.id,s.id,s.name,s.program,a.date,a.status,a.created_at
FROM attendance a JOIN students s ON s.id=a.student_id
WHERE a.status IN ('makeup','trial','other');

INSERT OR IGNORE INTO attendance_visits(id,name,program,date,kind,created_at)
SELECT 'legacy-trial-' || id,name,program,date,'trial',created_at FROM trials;
