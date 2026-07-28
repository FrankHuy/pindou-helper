-- Bead inventory management (account-bound cloud storage).
-- Tables: user_bead_inventory, user_inventory_settings, user_inventory_ledger.

CREATE TABLE IF NOT EXISTS user_bead_inventory (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  touched INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_user_bead_inventory_user
  ON user_bead_inventory (user_id);

CREATE TABLE IF NOT EXISTS user_inventory_settings (
  user_id TEXT PRIMARY KEY NOT NULL,
  low_stock_threshold INTEGER NOT NULL DEFAULT 100,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS user_inventory_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL, -- entry | set | deduct | adjust
  ref_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_ledger_user_time
  ON user_inventory_ledger (user_id, created_at DESC);
