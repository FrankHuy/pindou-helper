/**
 * AI cost guard pipeline (design §4 + image-edit units).
 * Order: session → banned → email verified → circuit → global → user → ip/fp associate.
 * Personal daily limit is role-aware (user/vip/admin); billable unit = image when units>1.
 */

import { getConfigBool, getConfigInt } from '../db/config'
import type { UserRow } from '../db/types'
import { getUsageCount, hasRemainingUnits, utcDayKey } from '../db/usage'
import { sha256Base64Url } from '../auth/crypto'
import { clientIp, jsonError, readClientFp } from '../auth/http'
import { resolveSessionUser } from '../auth/session'

export type AiGuardErrorCode =
  | 'auth_required'
  | 'banned'
  | 'email_unverified'
  | 'circuit_open'
  | 'global_quota'
  | 'user_quota'
  | 'associate_quota'

export type AiQuotaSnapshot = {
  day: string
  /** Personal daily limit; -1 means unlimited (admin/super). */
  userLimit: number
  userUsed: number
  userRemaining: number
  globalLimit: number
  globalUsed: number
  globalRemaining: number
  associateLimit: number
  ipUsed: number
  fpUsed: number
  circuitOpen: boolean
  emailVerified: boolean
}

export type AiAccessContext = {
  user: UserRow
  ip: string
  /** SHA-256 of client fingerprint, or null if missing. */
  fpHash: string | null
  day: string
  quota: AiQuotaSnapshot
}

export type AiAccessResult =
  | { ok: true; ctx: AiAccessContext }
  | { ok: false; response: Response }

export type RequireAiAccessOptions = {
  /**
   * Minimum remaining billable units required before calling upstream.
   * Image edit passes `n` (1–4); ping uses default 1.
   */
  units?: number
}

/**
 * Role-based personal daily image quota.
 * - override wins when set (≥0)
 * - admin / super_admin: unlimited (-1)
 * - vip role or vip plan: image_daily_quota_vip
 * - else: image_daily_quota_user
 */
export function effectiveUserDailyQuota(
  user: UserRow,
  quotas: { user: number; vip: number },
): number {
  if (user.daily_quota_override != null && user.daily_quota_override >= 0) {
    return user.daily_quota_override
  }
  if (user.role === 'admin' || user.role === 'super_admin') {
    return -1
  }
  if (user.role === 'vip' || user.plan === 'vip') {
    return quotas.vip
  }
  return quotas.user
}

export async function loadRoleQuotaConfig(db: D1Database): Promise<{
  userQuota: number
  vipQuota: number
  globalLimit: number
  associateLimit: number
}> {
  const [userQuota, vipQuota, imageGlobal, legacyGlobal, associateLimit] = await Promise.all([
    getConfigInt(db, 'image_daily_quota_user', 6),
    getConfigInt(db, 'image_daily_quota_vip', 20),
    getConfigInt(db, 'image_global_daily_cap', 500),
    getConfigInt(db, 'global_daily_cap', 500),
    getConfigInt(db, 'ip_fp_daily_cap', 10),
  ])
  // Prefer image_global_daily_cap; fall back to legacy global_daily_cap if image key missing in old DBs
  // (getConfigInt already returns default 500 for both).
  const globalLimit = imageGlobal > 0 ? imageGlobal : legacyGlobal
  return { userQuota, vipQuota, globalLimit, associateLimit }
}

export async function buildQuotaSnapshot(
  db: D1Database,
  user: UserRow,
  opts?: { ip?: string | null; fpHash?: string | null },
): Promise<AiQuotaSnapshot> {
  const day = utcDayKey()
  const { userQuota, vipQuota, globalLimit, associateLimit } = await loadRoleQuotaConfig(db)
  const userLimit = effectiveUserDailyQuota(user, { user: userQuota, vip: vipQuota })
  const circuitOpen = await getConfigBool(db, 'circuit_open', false)

  const [userUsed, globalUsed, ipUsed, fpUsed] = await Promise.all([
    getUsageCount(db, 'user', user.id, day),
    getUsageCount(db, 'global', 'global', day),
    opts?.ip ? getUsageCount(db, 'ip', opts.ip, day) : Promise.resolve(0),
    opts?.fpHash ? getUsageCount(db, 'fp', opts.fpHash, day) : Promise.resolve(0),
  ])

  return {
    day,
    userLimit,
    userUsed,
    // -1 remaining means unlimited personal quota (admin/super).
    userRemaining: userLimit < 0 ? -1 : Math.max(0, userLimit - userUsed),
    globalLimit,
    globalUsed,
    globalRemaining: Math.max(0, globalLimit - globalUsed),
    associateLimit,
    ipUsed,
    fpUsed,
    circuitOpen,
    emailVerified: user.email_verified_at != null,
  }
}

/**
 * Full pre-flight for `/api/ai/*`. Does not deduct usage.
 * Pass optional `body` so fingerprint can be read from JSON as well as header.
 * `units` reserves remaining capacity for multi-image image-edit submits.
 */
export async function requireAiAccess(
  db: D1Database,
  request: Request,
  body?: Record<string, unknown>,
  options?: RequireAiAccessOptions,
): Promise<AiAccessResult> {
  const units = Math.max(1, Math.floor(options?.units ?? 1))

  const sessionUser = await resolveSessionUser(db, request)
  if (!sessionUser) {
    return {
      ok: false,
      response: jsonError(401, 'auth_required', '请先登录后再使用 AI 功能'),
    }
  }

  const { user } = sessionUser
  if (user.banned_at != null) {
    return {
      ok: false,
      response: jsonError(403, 'banned', user.ban_reason?.trim() || '账号已被封禁'),
    }
  }

  if (user.email_verified_at == null) {
    return {
      ok: false,
      response: jsonError(403, 'email_unverified', '请先验证邮箱后再使用 AI 功能'),
    }
  }

  const day = utcDayKey()
  const circuitOpen = await getConfigBool(db, 'circuit_open', false)
  if (circuitOpen) {
    console.info('[guard] circuit_open', { userId: user.id })
    return {
      ok: false,
      response: jsonError(503, 'circuit_open', 'AI 服务暂时关闭，请稍后再试'),
    }
  }

  const { userQuota, vipQuota, globalLimit, associateLimit } = await loadRoleQuotaConfig(db)

  const globalCheck = await hasRemainingUnits(db, 'global', 'global', globalLimit, units, day)
  if (!globalCheck.ok) {
    console.info('[guard] quota_hit', { kind: 'global', count: globalCheck.count, units })
    return {
      ok: false,
      response: jsonError(429, 'global_quota', '今日全站 AI 调用已达上限，请明日再试'),
    }
  }

  const userLimit = effectiveUserDailyQuota(user, { user: userQuota, vip: vipQuota })
  const userCheck = await hasRemainingUnits(db, 'user', user.id, userLimit, units, day)
  if (!userCheck.ok) {
    console.info('[guard] quota_hit', {
      kind: 'user',
      userId: user.id,
      count: userCheck.count,
      units,
    })
    return {
      ok: false,
      response: jsonError(429, 'user_quota', '今日个人 AI 配额已用完，请明日再试'),
    }
  }

  const ip = clientIp(request)
  // Associate caps are per-request style limits; still require remaining ≥ units.
  const ipCheck = await hasRemainingUnits(db, 'ip', ip, associateLimit, units, day)
  if (!ipCheck.ok) {
    console.info('[guard] quota_hit', { kind: 'ip', count: ipCheck.count, units })
    return {
      ok: false,
      response: jsonError(429, 'associate_quota', '当前网络今日 AI 调用过多，请明日再试'),
    }
  }

  const fpRaw = readClientFp(request, body)
  const fpHash = fpRaw ? await sha256Base64Url(fpRaw) : null
  // Missing fingerprint: still enforce IP associate cap (already done). Soft signal only.
  if (fpHash) {
    const fpCheck = await hasRemainingUnits(db, 'fp', fpHash, associateLimit, units, day)
    if (!fpCheck.ok) {
      console.info('[guard] quota_hit', { kind: 'fp', count: fpCheck.count, units })
      return {
        ok: false,
        response: jsonError(429, 'associate_quota', '当前设备今日 AI 调用过多，请明日再试'),
      }
    }
  }

  const quota = await buildQuotaSnapshot(db, user, { ip, fpHash })
  return {
    ok: true,
    ctx: { user, ip, fpHash, day, quota },
  }
}
