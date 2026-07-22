/**
 * AI cost guard pipeline (design §4).
 * Order: session → banned → email verified → circuit → global → user → ip/fp associate.
 */

import { getConfigBool, getConfigInt } from '../db/config'
import type { UserRow } from '../db/types'
import { getUsageCount, isUnderCap, utcDayKey } from '../db/usage'
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

export function effectiveUserDailyQuota(
  user: UserRow,
  defaultDailyQuota: number,
): number {
  if (user.daily_quota_override != null && user.daily_quota_override >= 0) {
    return user.daily_quota_override
  }
  // VIP plan/role may use a higher default later; Phase 1 same as free.
  return defaultDailyQuota
}

export async function buildQuotaSnapshot(
  db: D1Database,
  user: UserRow,
  opts?: { ip?: string | null; fpHash?: string | null },
): Promise<AiQuotaSnapshot> {
  const day = utcDayKey()
  const defaultQuota = await getConfigInt(db, 'default_daily_quota', 3)
  const userLimit = effectiveUserDailyQuota(user, defaultQuota)
  const globalLimit = await getConfigInt(db, 'global_daily_cap', 500)
  const associateLimit = await getConfigInt(db, 'ip_fp_daily_cap', 10)
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
    userRemaining: Math.max(0, userLimit - userUsed),
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
 */
export async function requireAiAccess(
  db: D1Database,
  request: Request,
  body?: Record<string, unknown>,
): Promise<AiAccessResult> {
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

  const globalLimit = await getConfigInt(db, 'global_daily_cap', 500)
  const globalCheck = await isUnderCap(db, 'global', 'global', globalLimit, day)
  if (!globalCheck.ok) {
    console.info('[guard] quota_hit', { kind: 'global', count: globalCheck.count })
    return {
      ok: false,
      response: jsonError(429, 'global_quota', '今日全站 AI 调用已达上限，请明日再试'),
    }
  }

  const defaultQuota = await getConfigInt(db, 'default_daily_quota', 3)
  const userLimit = effectiveUserDailyQuota(user, defaultQuota)
  const userCheck = await isUnderCap(db, 'user', user.id, userLimit, day)
  if (!userCheck.ok) {
    console.info('[guard] quota_hit', { kind: 'user', userId: user.id, count: userCheck.count })
    return {
      ok: false,
      response: jsonError(429, 'user_quota', '今日个人 AI 配额已用完，请明日再试'),
    }
  }

  const ip = clientIp(request)
  const associateLimit = await getConfigInt(db, 'ip_fp_daily_cap', 10)
  const ipCheck = await isUnderCap(db, 'ip', ip, associateLimit, day)
  if (!ipCheck.ok) {
    console.info('[guard] quota_hit', { kind: 'ip', count: ipCheck.count })
    return {
      ok: false,
      response: jsonError(429, 'associate_quota', '当前网络今日 AI 调用过多，请明日再试'),
    }
  }

  const fpRaw = readClientFp(request, body)
  const fpHash = fpRaw ? await sha256Base64Url(fpRaw) : null
  // Missing fingerprint: still enforce IP associate cap (already done). Soft signal only.
  if (fpHash) {
    const fpCheck = await isUnderCap(db, 'fp', fpHash, associateLimit, day)
    if (!fpCheck.ok) {
      console.info('[guard] quota_hit', { kind: 'fp', count: fpCheck.count })
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
