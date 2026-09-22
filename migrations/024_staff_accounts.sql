CREATE TABLE IF NOT EXISTS staff_accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')),
 password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 version INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_audit (
 id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, username TEXT NOT NULL,
 action TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_audit_time ON staff_audit(created_at DESC);
