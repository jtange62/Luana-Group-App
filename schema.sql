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

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);
CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_files_lesson ON lesson_files (lesson_id);
