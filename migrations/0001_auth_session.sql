-- Phase 1 auth + cost-guard foundation (auth-session child)
-- Day boundary for usage counters: UTC.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_domain TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iters INTEGER NOT NULL,
  email_verified_at INTEGER,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  banned_at INTEGER,
  ban_reason TEXT,
  daily_quota_override INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email_domain ON users (email_domain);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_ip TEXT,
  created_fp_hash TEXT,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens (user_id, purpose);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject_type, subject_key)
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Seed defaults (allowlist + caps). UPSERT-friendly for re-apply.
INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES
  ('email_domain_allowlist', '["qq.com","gmail.com","frankiehu.top"]', 0),
  ('default_daily_quota', '3', 0),
  ('ip_fp_daily_cap', '10', 0),
  ('global_daily_cap', '500', 0),
  ('circuit_open', 'false', 0),
  ('register_ip_daily_cap', '3', 0),
  ('register_fp_daily_cap', '2', 0),
  ('auth_fail_ip_daily_cap', '30', 0),
  ('auth_fail_email_daily_cap', '15', 0);
