-- Add file attachments to idea board posts.
CREATE TABLE IF NOT EXISTS post_files (
  id       TEXT PRIMARY KEY,
  post_id  TEXT NOT NULL,
  filename TEXT NOT NULL,
  size     INTEGER,
  type     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_files_post ON post_files (post_id);
