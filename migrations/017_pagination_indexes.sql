-- Composite indexes for stable cursor pagination and filtered Library pages.
CREATE INDEX IF NOT EXISTS idx_posts_cursor
  ON posts (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lessons_cursor
  ON lessons (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lessons_filter
  ON lessons (program, month, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_cursor
  ON submissions (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_status_cursor
  ON submissions (status, created_at DESC, id DESC);
