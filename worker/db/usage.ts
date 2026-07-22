/** usage_daily counters — UTC day keys. Shared with future quota-guard. */

import type { UsageSubjectType } from './types'

/** YYYY-MM-DD in UTC. */
export function utcDayKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export async function getUsageCount(
  db: D1Database,
  subjectType: UsageSubjectType,
  subjectKey: string,
  day = utcDayKey(),
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT count FROM usage_daily WHERE day = ? AND subject_type = ? AND subject_key = ?',
    )
    .bind(day, subjectType, subjectKey)
    .first<{ count: number }>()
  return row?.count ?? 0
}

/** Increment by `delta` (default 1). Returns new count. */
export async function incrementUsage(
  db: D1Database,
  subjectType: UsageSubjectType,
  subjectKey: string,
  delta = 1,
  day = utcDayKey(),
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO usage_daily (day, subject_type, subject_key, count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day, subject_type, subject_key)
       DO UPDATE SET count = count + excluded.count`,
    )
    .bind(day, subjectType, subjectKey, delta)
    .run()
  return getUsageCount(db, subjectType, subjectKey, day)
}

export async function isUnderCap(
  db: D1Database,
  subjectType: UsageSubjectType,
  subjectKey: string,
  cap: number,
  day = utcDayKey(),
): Promise<{ ok: true; count: number } | { ok: false; count: number }> {
  const count = await getUsageCount(db, subjectType, subjectKey, day)
  if (count >= cap) return { ok: false, count }
  return { ok: true, count }
}
