/** Billable-success usage deduction for AI calls (UTC day). */

import { getUsageCount, incrementUsage, utcDayKey } from '../db/usage'
import type { AiAccessContext, AiQuotaSnapshot } from './requireAiAccess'
import { effectiveUserDailyQuota, loadRoleQuotaConfig } from './requireAiAccess'
import { getConfigBool } from '../db/config'

/**
 * Increment user + ip + fp + global after a billable AI success.
 * Fingerprint increment is skipped when fp was missing at gate time.
 * `delta` is the number of successfully delivered images (k) for image-edit.
 */
export async function deductAiUsage(
  db: D1Database,
  ctx: Pick<AiAccessContext, 'user' | 'ip' | 'fpHash' | 'day'>,
  delta = 1,
): Promise<AiQuotaSnapshot> {
  const day = ctx.day || utcDayKey()
  const units = Math.max(0, Math.floor(delta))
  if (units <= 0) {
    return refreshQuotaAfterDeduct(db, ctx)
  }

  await incrementUsage(db, 'user', ctx.user.id, units, day)
  await incrementUsage(db, 'ip', ctx.ip, units, day)
  if (ctx.fpHash) {
    await incrementUsage(db, 'fp', ctx.fpHash, units, day)
  }
  await incrementUsage(db, 'global', 'global', units, day)

  return refreshQuotaAfterDeduct(db, ctx)
}

async function refreshQuotaAfterDeduct(
  db: D1Database,
  ctx: Pick<AiAccessContext, 'user' | 'ip' | 'fpHash' | 'day'>,
): Promise<AiQuotaSnapshot> {
  const day = ctx.day || utcDayKey()
  const { userQuota, vipQuota, globalLimit, associateLimit } = await loadRoleQuotaConfig(db)
  const userLimit = effectiveUserDailyQuota(ctx.user, { user: userQuota, vip: vipQuota })
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
    userRemaining: userLimit < 0 ? -1 : Math.max(0, userLimit - userUsed),
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
    user: quota.userLimit < 0 ? -1 : quota.userRemaining,
    userLimit: quota.userLimit,
    userUsed: quota.userUsed,
    global: quota.globalRemaining,
    globalLimit: quota.globalLimit,
    associateLimit: quota.associateLimit,
    circuitOpen: quota.circuitOpen,
  }
}
