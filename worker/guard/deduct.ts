/** Billable-success usage deduction for AI calls (UTC day). */

import { getUsageCount, incrementUsage, utcDayKey } from '../db/usage'
import type { AiAccessContext, AiQuotaSnapshot } from './requireAiAccess'
import { effectiveUserDailyQuota } from './requireAiAccess'
import { getConfigBool, getConfigInt } from '../db/config'

/**
 * Increment user + ip + fp + global after a billable AI success.
 * Fingerprint increment is skipped when fp was missing at gate time.
 */
export async function deductAiUsage(
  db: D1Database,
  ctx: Pick<AiAccessContext, 'user' | 'ip' | 'fpHash' | 'day'>,
  delta = 1,
): Promise<AiQuotaSnapshot> {
  const day = ctx.day || utcDayKey()

  await incrementUsage(db, 'user', ctx.user.id, delta, day)
  await incrementUsage(db, 'ip', ctx.ip, delta, day)
  if (ctx.fpHash) {
    await incrementUsage(db, 'fp', ctx.fpHash, delta, day)
  }
  await incrementUsage(db, 'global', 'global', delta, day)

  return refreshQuotaAfterDeduct(db, ctx)
}

async function refreshQuotaAfterDeduct(
  db: D1Database,
  ctx: Pick<AiAccessContext, 'user' | 'ip' | 'fpHash' | 'day'>,
): Promise<AiQuotaSnapshot> {
  const day = ctx.day || utcDayKey()
  const defaultQuota = await getConfigInt(db, 'default_daily_quota', 3)
  const userLimit = effectiveUserDailyQuota(ctx.user, defaultQuota)
  const globalLimit = await getConfigInt(db, 'global_daily_cap', 500)
  const associateLimit = await getConfigInt(db, 'ip_fp_daily_cap', 10)
  const circuitOpen = await getConfigBool(db, 'circuit_open', false)

  const [userUsed, globalUsed, ipUsed, fpUsed] = await Promise.all([
    getUsageCount(db, 'user', ctx.user.id, day),
    getUsageCount(db, 'global', 'global', day),
    getUsageCount(db, 'ip', ctx.ip, day),
    ctx.fpHash ? getUsageCount(db, 'fp', ctx.fpHash, day) : Promise.resolve(0),
  ])

  return {
    day,
    userLimit,
    userUsed,
    userRemaining: Math.max(0, userLimit - userUsed),
    globalLimit,
    globalUsed,
    globalRemaining: Math.max(0, globalLimit - globalUsed),
    associateLimit,
    ipUsed,
    fpUsed,
    circuitOpen,
    emailVerified: ctx.user.email_verified_at != null,
  }
}

/** Remaining counters suitable for API response bodies. */
export function remainingFromSnapshot(quota: AiQuotaSnapshot) {
  return {
    day: quota.day,
    user: quota.userRemaining,
    userLimit: quota.userLimit,
    userUsed: quota.userUsed,
    global: quota.globalRemaining,
    associateLimit: quota.associateLimit,
    circuitOpen: quota.circuitOpen,
  }
}
