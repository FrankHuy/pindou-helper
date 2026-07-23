/** app_config key/value helpers (JSON or plain scalars as text). */

const DEFAULTS: Record<string, string> = {
  email_domain_allowlist: '["qq.com","gmail.com","frankiehu.top"]',
  /** @deprecated Prefer image_daily_quota_user; kept for older admin UIs. */
  default_daily_quota: '6',
  image_daily_quota_user: '6',
  image_daily_quota_vip: '20',
  image_global_daily_cap: '500',
  image_edit_enabled: 'true',
  ip_fp_daily_cap: '10',
  /** @deprecated Prefer image_global_daily_cap. */
  global_daily_cap: '500',
  circuit_open: 'false',
  register_ip_daily_cap: '3',
  register_fp_daily_cap: '2',
  auth_fail_ip_daily_cap: '30',
  auth_fail_email_daily_cap: '15',
}

export async function getConfigValue(db: D1Database, key: string): Promise<string> {
  const row = await db
    .prepare('SELECT value FROM app_config WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  if (row?.value != null && row.value !== '') return row.value
  return DEFAULTS[key] ?? ''
}

export async function getConfigInt(db: D1Database, key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(db, key)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export async function getConfigBool(db: D1Database, key: string, fallback = false): Promise<boolean> {
  const raw = (await getConfigValue(db, key)).trim().toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'yes') return true
  if (raw === 'false' || raw === '0' || raw === 'no') return false
  return fallback
}

/** Exact domain match, case-insensitive. No free-subdomain pass. */
export async function getEmailDomainAllowlist(db: D1Database): Promise<string[]> {
  const raw = await getConfigValue(db, 'email_domain_allowlist')
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return defaultAllowlist()
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
  } catch {
    // Comma-separated fallback
    if (raw.includes(',')) {
      return raw
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    }
    return defaultAllowlist()
  }
}

function defaultAllowlist(): string[] {
  return ['qq.com', 'gmail.com', 'frankiehu.top']
}

export function isDomainAllowed(domain: string, allowlist: string[]): boolean {
  const d = domain.trim().toLowerCase()
  if (!d) return false
  return allowlist.some((allowed) => allowed === d)
}

/** Upsert app_config value (admin / runtime). */
export async function setConfigValue(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run()
}

/** Normalize and persist email domain allowlist as JSON array. */
export async function setEmailDomainAllowlist(
  db: D1Database,
  domains: string[],
): Promise<string[]> {
  const normalized = [
    ...new Set(
      domains
        .filter((item): item is string => typeof item === 'string')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort()
  await setConfigValue(db, 'email_domain_allowlist', JSON.stringify(normalized))
  return normalized
}
