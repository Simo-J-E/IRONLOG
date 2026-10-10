PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_init.sql','2026-10-09 20:20:05');
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  ranked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  data TEXT,
  sequence INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  workout_count INTEGER NOT NULL DEFAULT 0,
  working_sets INTEGER NOT NULL DEFAULT 0,
  bench REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, collection, id)
);
CREATE TABLE sequence_counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
INSERT INTO "sequence_counter" ("id","value") VALUES(1,0);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
INSERT INTO "rate_limits" ("key","hits","reset_at") VALUES('api:85.23.30.24',4,1791578715228);
INSERT INTO "rate_limits" ("key","hits","reset_at") VALUES('auth:85.23.30.24',10,1791579447003);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX records_pull ON records(user_id, sequence);
