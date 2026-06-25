-- Luana Idea Board — database schema
-- Run this once against your D1 database (see SETUP.md).

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  link_url    TEXT,
  link_title  TEXT,
  link_desc   TEXT,
  link_image  TEXT,
  link_domain TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL,
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Lesson library — entries can hold notes, links, and uploaded files (R2).
CREATE TABLE IF NOT EXISTS lessons (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL,
  program     TEXT,          -- Preschool | Kinder | After School | Summer School
  month       TEXT,          -- "1".."12", or empty for all-year/general
  notes       TEXT,
  link_url    TEXT,
  tags        TEXT,
  created_at  INTEGER NOT NULL
);

-- One row per uploaded file. The R2 object key is the file id.
CREATE TABLE IF NOT EXISTS lesson_files (
  id          TEXT PRIMARY KEY,
  lesson_id   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  size        INTEGER,
  type        TEXT,
  created_at  INTEGER NOT NULL
);

-- Calendar events. Recurring events store a rule and are expanded on read.
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL,
  calendar    TEXT,            -- students|staff
  program     TEXT,            -- Preschool|Kinder|After School|Summer School|General (students)
  staff_name  TEXT,            -- person working (staff calendar)
  lesson_id   TEXT,            -- optional link to a lesson-library theme (students)
  start_date  TEXT NOT NULL,   -- "YYYY-MM-DD"
  start_time  TEXT,            -- "HH:MM", or empty for all-day
  end_time    TEXT,            -- optional "HH:MM"
  notes       TEXT,
  recur       TEXT,            -- none|daily|weekly|monthly
  recur_until TEXT,            -- optional "YYYY-MM-DD" end of recurrence
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_files (
  id       TEXT PRIMARY KEY,
  post_id  TEXT NOT NULL,
  filename TEXT NOT NULL,
  size     INTEGER,
  type     TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);
CREATE INDEX IF NOT EXISTS idx_post_files_post ON post_files (post_id);
CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_files_lesson ON lesson_files (lesson_id);
-- Student roster (for attendance) and staff roster (for shift assignment).
CREATE TABLE IF NOT EXISTS students (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  program     TEXT NOT NULL,   -- Preschool|Kinder|After School|Summer School
  days        TEXT,            -- weekdays they attend, e.g. "3,5" (0=Sun..6=Sat); empty = every day
  active      INTEGER DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  active      INTEGER DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- One attendance mark per student per day.
CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL,   -- "YYYY-MM-DD"
  status      TEXT NOT NULL,   -- present|absent|late
  marked_by   TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (student_id, date)
);

-- Website inbox: staff drop content (photos, PDFs, newsletters, requests,
-- suggestions) for the site manager. Files live in R2 like lesson files.
CREATE TABLE IF NOT EXISTS submissions (
  id          TEXT PRIMARY KEY,
  author      TEXT NOT NULL,
  type        TEXT,            -- Photo|Newsletter|Document|Request|Suggestion|Other
  title       TEXT,
  notes       TEXT,
  status      TEXT DEFAULT 'new',  -- new|done
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_files (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  filename      TEXT NOT NULL,
  size          INTEGER,
  type          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_date);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submission_files_sub ON submission_files (submission_id);
CREATE INDEX IF NOT EXISTS idx_students_program ON students (program);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
