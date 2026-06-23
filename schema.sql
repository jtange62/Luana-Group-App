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

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);
