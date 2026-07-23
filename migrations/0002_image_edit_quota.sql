-- Image-edit quotas (bead AI 优化). Billable unit = one delivered candidate image.
-- Keeps legacy default_daily_quota / global_daily_cap rows; app prefers image_* keys.

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES
  ('image_daily_quota_user', '6', 0),
  ('image_daily_quota_vip', '20', 0),
  ('image_global_daily_cap', '500', 0),
  ('image_edit_enabled', 'true', 0);

-- Align legacy keys for operators still reading them (optional soft migrate).
UPDATE app_config SET value = '6', updated_at = 0
  WHERE key = 'default_daily_quota' AND value = '3';
