-- Photo consent flag: 1 = OK to post pictures, 0 = do not post (default).
ALTER TABLE students ADD COLUMN photo_ok INTEGER DEFAULT 0;
