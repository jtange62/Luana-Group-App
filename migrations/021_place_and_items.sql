-- 021: close the gap between brainstorming and the curriculum.
--
-- The idea board holds 16 curriculum posts — mostly Summer School vocab lists —
-- while the matching curriculum day themes have their vocab field empty on 12
-- of 13 days. Exactly one list was copied across by hand (Summertime into
-- 2026-07-27) and then the copying stopped. The intent was always to file this
-- content; the manual step killed it.
--
-- placed_at / placed_note record that a post has been filed somewhere, so the
-- board can show what is still waiting rather than one undifferentiated feed.

ALTER TABLE posts ADD COLUMN placed_at   INTEGER;  -- when it was filed into the curriculum
ALTER TABLE posts ADD COLUMN placed_note TEXT;     -- where, e.g. "Summer School · Aug · Under The Sea · vocab"

CREATE INDEX IF NOT EXISTS idx_posts_placed ON posts (placed_at, created_at DESC);

-- Checkable items under a post: the supplies to gather or the steps to build
-- something. Nine of the existing posts are shopping lists written as prose.
CREATE TABLE IF NOT EXISTS post_items (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_items_post ON post_items (post_id, created_at);
