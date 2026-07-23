/**
 * Mini admin APIs — design §5 + role matrix.
 * All routes require session role ∈ {admin, super_admin}.
 * Super-only: allowlist + role change.
 */

import {
  getConfigBool,
  getConfigInt,
  getEmailDomainAllowlist,
  setConfigValue,
  setEmailDomainAllowlist,
} from '../db/config'
import type { UserRole, UserRow } from '../db/types'
import { getUsageCount, utcDayKey } from '../db/usage'
import { jsonError, jsonOk, readJsonBody } from '../auth/http'
import { resolveSessionUser, type SessionUser } from '../auth/session'

export type AdminWorkerEnv = {
  DB: D1Database
}

const ADMIN_USER_SELECT = `SELECT id, email, email_domain, password_hash, password_salt, password_iters,
              email_verified_at, role, plan, banned_at, ban_reason, daily_quota_override,
              created_at, updated_at
       FROM users`

const ALL_ROLES: UserRole[] = ['user', 'vip', 'admin', 'super_admin']

function isAdminRole(role: UserRole): boolean {
  return role === 'admin' || role === 'super_admin'
}

function isSuperRole(role: UserRole): boolean {
  return role === 'super_admin'
}

function adminPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    emailDomain: user.email_domain,
    role: user.role,
    plan: user.plan,
    emailVerified: user.email_verified_at != null,
    banned: user.banned_at != null,
    banReason: user.ban_reason,
    dailyQuotaOverride: user.daily_quota_override,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  }
}

async function loadUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(`${ADMIN_USER_SELECT} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<UserRow>()
}

/**
 * Same-origin gate for cookie-session mutating admin calls (design CSRF note).
 * Accepts Origin or Referer host match against request URL host.
 */
export function assertSameOriginMutating(request: Request): Response | null {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null

  const url = new URL(request.url)
  const origin = request.headers.get('Origin')?.trim()
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) {
        return jsonError(403, 'csrf_rejected', '跨站请求被拒绝')
      }
      return null
    } catch {
      return jsonError(403, 'csrf_rejected', '跨站请求被拒绝')
    }
  }

  const referer = request.headers.get('Referer')?.trim()
  if (referer) {
    try {
      if (new URL(referer).host !== url.host) {
        return jsonError(403, 'csrf_rejected', '跨站请求被拒绝')
      }
      return null
    } catch {
      return jsonError(403, 'csrf_rejected', '跨站请求被拒绝')
    }
  }

  return jsonError(403, 'csrf_rejected', '缺少同源校验头')
}

async function requireAdmin(
  db: D1Database,
  request: Request,
  opts?: { superOnly?: boolean },
): Promise<{ ok: true; session: SessionUser } | { ok: false; response: Response }> {
  const session = await resolveSessionUser(db, request)
  if (!session) {
    return { ok: false, response: jsonError(401, 'auth_required', '请先登录') }
  }
  if (session.user.banned_at != null) {
    return {
      ok: false,
      response: jsonError(403, 'banned', session.user.ban_reason?.trim() || '账号已被封禁'),
    }
  }
  if (!isAdminRole(session.user.role)) {
    return { ok: false, response: jsonError(403, 'forbidden', '需要管理员权限') }
  }
  if (opts?.superOnly && !isSuperRole(session.user.role)) {
    return { ok: false, response: jsonError(403, 'forbidden', '需要超级管理员权限') }
  }
  return { ok: true, session }
}

function logAdmin(
  action: string,
  actor: UserRow,
  detail: Record<string, unknown> = {},
): void {
  console.info('[admin] admin_action', {
    action,
    actorId: actor.id,
    actorRole: actor.role,
    ...detail,
  })
}

/** Admin cannot operate super_admin targets (ban / unban). Super may. */
function adminMayTouchTarget(actor: UserRow, target: UserRow): boolean {
  if (isSuperRole(actor.role)) return true
  if (isSuperRole(target.role)) return false
  return true
}

export async function handleAdminUsersSearch(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '30', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 30

  let rows: UserRow[]
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`
    const result = await env.DB.prepare(
      `${ADMIN_USER_SELECT}
       WHERE lower(email) LIKE ? OR id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(like, q, limit)
      .all<UserRow>()
    rows = result.results ?? []
  } else {
    const result = await env.DB.prepare(
      `${ADMIN_USER_SELECT}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all<UserRow>()
    rows = result.results ?? []
  }

  return jsonOk({
    users: rows.map(adminPublicUser),
    q,
    limit,
  })
}

export async function handleAdminBan(
  request: Request,
  env: AdminWorkerEnv,
  userId: string,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const reason =
    typeof parsed.body.reason === 'string' ? parsed.body.reason.trim().slice(0, 500) : ''

  const target = await loadUserById(env.DB, userId)
  if (!target) return jsonError(404, 'not_found', '用户不存在')
  if (target.id === auth.session.user.id) {
    return jsonError(400, 'invalid_request', '不能封禁自己')
  }
  if (!adminMayTouchTarget(auth.session.user, target)) {
    return jsonError(403, 'forbidden', '管理员不能操作超级管理员账号')
  }

  const now = Date.now()
  await env.DB.prepare(
    `UPDATE users SET banned_at = ?, ban_reason = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(now, reason || null, now, target.id)
    .run()

  logAdmin('ban', auth.session.user, { targetId: target.id, reason: reason || null })
  const refreshed = await loadUserById(env.DB, target.id)
  return jsonOk({
    user: refreshed ? adminPublicUser(refreshed) : null,
    message: '已封禁',
  })
}

export async function handleAdminUnban(
  request: Request,
  env: AdminWorkerEnv,
  userId: string,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  // Body optional for unban; accept empty object or no JSON carefully.
  if (request.headers.get('Content-Type')?.includes('application/json')) {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response
  }

  const target = await loadUserById(env.DB, userId)
  if (!target) return jsonError(404, 'not_found', '用户不存在')
  if (!adminMayTouchTarget(auth.session.user, target)) {
    return jsonError(403, 'forbidden', '管理员不能操作超级管理员账号')
  }

  const now = Date.now()
  await env.DB.prepare(
    `UPDATE users SET banned_at = NULL, ban_reason = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(now, target.id)
    .run()

  logAdmin('unban', auth.session.user, { targetId: target.id })
  const refreshed = await loadUserById(env.DB, target.id)
  return jsonOk({
    user: refreshed ? adminPublicUser(refreshed) : null,
    message: '已解封',
  })
}

export async function handleAdminQuota(
  request: Request,
  env: AdminWorkerEnv,
  userId: string,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  if (!('dailyQuotaOverride' in parsed.body)) {
    return jsonError(400, 'invalid_request', '缺少 dailyQuotaOverride')
  }

  const raw = parsed.body.dailyQuotaOverride
  let override: number | null
  if (raw === null) {
    override = null
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1_000_000) {
    override = Math.floor(raw)
  } else if (typeof raw === 'string' && raw.trim() === '') {
    override = null
  } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    override = Math.min(1_000_000, Number.parseInt(raw.trim(), 10))
  } else {
    return jsonError(400, 'invalid_request', 'dailyQuotaOverride 须为非负整数或 null')
  }

  const target = await loadUserById(env.DB, userId)
  if (!target) return jsonError(404, 'not_found', '用户不存在')
  if (!adminMayTouchTarget(auth.session.user, target)) {
    return jsonError(403, 'forbidden', '管理员不能操作超级管理员账号')
  }

  const now = Date.now()
  await env.DB.prepare(
    `UPDATE users SET daily_quota_override = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(override, now, target.id)
    .run()

  logAdmin('quota', auth.session.user, { targetId: target.id, dailyQuotaOverride: override })
  const refreshed = await loadUserById(env.DB, target.id)
  return jsonOk({
    user: refreshed ? adminPublicUser(refreshed) : null,
    message: '配额已更新',
  })
}

export async function handleAdminRole(
  request: Request,
  env: AdminWorkerEnv,
  userId: string,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request, { superOnly: true })
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const roleRaw = typeof parsed.body.role === 'string' ? parsed.body.role.trim() : ''
  if (!ALL_ROLES.includes(roleRaw as UserRole)) {
    return jsonError(400, 'invalid_request', '无效角色')
  }
  const nextRole = roleRaw as UserRole

  const target = await loadUserById(env.DB, userId)
  if (!target) return jsonError(404, 'not_found', '用户不存在')
  if (target.id === auth.session.user.id && nextRole !== 'super_admin') {
    return jsonError(400, 'invalid_request', '不能降低自己的超级管理员角色')
  }

  const now = Date.now()
  await env.DB.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`)
    .bind(nextRole, now, target.id)
    .run()

  logAdmin('role', auth.session.user, { targetId: target.id, role: nextRole })
  const refreshed = await loadUserById(env.DB, target.id)
  return jsonOk({
    user: refreshed ? adminPublicUser(refreshed) : null,
    message: '角色已更新',
  })
}

export async function handleAdminUsageSummary(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const day = utcDayKey()
  const [
    globalUsed,
    globalLimit,
    defaultDailyQuota,
    imageDailyQuotaUser,
    imageDailyQuotaVip,
    associateLimit,
    circuitOpen,
    imageEditEnabled,
  ] = await Promise.all([
    getUsageCount(env.DB, 'global', 'global', day),
    getConfigInt(env.DB, 'image_global_daily_cap', 500),
    getConfigInt(env.DB, 'image_daily_quota_user', 6),
    getConfigInt(env.DB, 'image_daily_quota_user', 6),
    getConfigInt(env.DB, 'image_daily_quota_vip', 20),
    getConfigInt(env.DB, 'ip_fp_daily_cap', 10),
    getConfigBool(env.DB, 'circuit_open', false),
    getConfigBool(env.DB, 'image_edit_enabled', true),
  ])

  const topResult = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.role AS role, d.count AS count
     FROM usage_daily d
     INNER JOIN users u ON u.id = d.subject_key
     WHERE d.day = ? AND d.subject_type = 'user'
     ORDER BY d.count DESC
     LIMIT 20`,
  )
    .bind(day)
    .all<{ id: string; email: string; role: string; count: number }>()

  const topUsers = (topResult.results ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    count: row.count,
  }))

  return jsonOk({
    day,
    circuitOpen,
    global: {
      used: globalUsed,
      limit: globalLimit,
      remaining: Math.max(0, globalLimit - globalUsed),
    },
    defaultDailyQuota,
    imageDailyQuotaUser,
    imageDailyQuotaVip,
    imageGlobalDailyCap: globalLimit,
    imageEditEnabled,
    associateLimit,
    topUsers,
  })
}

export async function handleAdminCircuitGet(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const open = await getConfigBool(env.DB, 'circuit_open', false)
  return jsonOk({ open, circuitOpen: open })
}

export async function handleAdminCircuitSet(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  if (typeof parsed.body.open !== 'boolean') {
    return jsonError(400, 'invalid_request', 'open 须为布尔值')
  }
  const open = parsed.body.open
  await setConfigValue(env.DB, 'circuit_open', open ? 'true' : 'false')
  logAdmin('circuit', auth.session.user, { open })
  return jsonOk({ open, circuitOpen: open, message: open ? '全局熔断已开启' : '全局熔断已关闭' })
}

/** GET/POST /api/admin/config/image-quota — image daily caps (admin). */
export async function handleAdminImageQuotaGet(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const [imageDailyQuotaUser, imageDailyQuotaVip, imageGlobalDailyCap, imageEditEnabled] =
    await Promise.all([
      getConfigInt(env.DB, 'image_daily_quota_user', 6),
      getConfigInt(env.DB, 'image_daily_quota_vip', 20),
      getConfigInt(env.DB, 'image_global_daily_cap', 500),
      getConfigBool(env.DB, 'image_edit_enabled', true),
    ])

  return jsonOk({
    imageDailyQuotaUser,
    imageDailyQuotaVip,
    imageGlobalDailyCap,
    imageEditEnabled,
  })
}

export async function handleAdminImageQuotaSet(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const parsePositiveInt = (value: unknown, label: string): number | Response => {
    if (typeof value !== 'number' && typeof value !== 'string') {
      return jsonError(400, 'invalid_request', `${label} 须为正整数`)
    }
    const n = typeof value === 'number' ? value : Number.parseInt(value, 10)
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return jsonError(400, 'invalid_request', `${label} 须为 0–1000000 的整数`)
    }
    return n
  }

  if (body.imageDailyQuotaUser !== undefined) {
    const n = parsePositiveInt(body.imageDailyQuotaUser, '普通用户日额度')
    if (n instanceof Response) return n
    await setConfigValue(env.DB, 'image_daily_quota_user', String(n))
    // Keep legacy key loosely aligned for older readers.
    await setConfigValue(env.DB, 'default_daily_quota', String(n))
  }
  if (body.imageDailyQuotaVip !== undefined) {
    const n = parsePositiveInt(body.imageDailyQuotaVip, 'VIP 日额度')
    if (n instanceof Response) return n
    await setConfigValue(env.DB, 'image_daily_quota_vip', String(n))
  }
  if (body.imageGlobalDailyCap !== undefined) {
    const n = parsePositiveInt(body.imageGlobalDailyCap, '全站日上限')
    if (n instanceof Response) return n
    await setConfigValue(env.DB, 'image_global_daily_cap', String(n))
    await setConfigValue(env.DB, 'global_daily_cap', String(n))
  }
  if (body.imageEditEnabled !== undefined) {
    if (typeof body.imageEditEnabled !== 'boolean') {
      return jsonError(400, 'invalid_request', 'imageEditEnabled 须为布尔值')
    }
    await setConfigValue(env.DB, 'image_edit_enabled', body.imageEditEnabled ? 'true' : 'false')
  }

  logAdmin('image_quota', auth.session.user, body)

  const [imageDailyQuotaUser, imageDailyQuotaVip, imageGlobalDailyCap, imageEditEnabled] =
    await Promise.all([
      getConfigInt(env.DB, 'image_daily_quota_user', 6),
      getConfigInt(env.DB, 'image_daily_quota_vip', 20),
      getConfigInt(env.DB, 'image_global_daily_cap', 500),
      getConfigBool(env.DB, 'image_edit_enabled', true),
    ])

  return jsonOk({
    imageDailyQuotaUser,
    imageDailyQuotaVip,
    imageGlobalDailyCap,
    imageEditEnabled,
    message: '出图配额已更新',
  })
}

export async function handleAdminAllowlistGet(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const auth = await requireAdmin(env.DB, request, { superOnly: true })
  if (!auth.ok) return auth.response

  const domains = await getEmailDomainAllowlist(env.DB)
  return jsonOk({ domains })
}

export async function handleAdminAllowlistPut(
  request: Request,
  env: AdminWorkerEnv,
): Promise<Response> {
  const originErr = assertSameOriginMutating(request)
  if (originErr) return originErr

  const auth = await requireAdmin(env.DB, request, { superOnly: true })
  if (!auth.ok) return auth.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  if (!Array.isArray(parsed.body.domains)) {
    return jsonError(400, 'invalid_request', 'domains 须为字符串数组')
  }
  const rawDomains = parsed.body.domains
  if (!rawDomains.every((d) => typeof d === 'string')) {
    return jsonError(400, 'invalid_request', 'domains 须为字符串数组')
  }
  if (rawDomains.length > 200) {
    return jsonError(400, 'invalid_request', '域名数量过多')
  }

  // Basic domain shape: labels + dots, no protocol/path
  for (const d of rawDomains) {
    const domain = d.trim().toLowerCase()
    if (!domain) continue
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return jsonError(400, 'invalid_request', `无效域名：${domain}`)
    }
  }

  const domains = await setEmailDomainAllowlist(env.DB, rawDomains as string[])
  logAdmin('allowlist', auth.session.user, { domains })
  return jsonOk({ domains, message: '白名单已更新' })
}

/**
 * Dispatch `/api/admin/*` after path match. Returns null if path is not admin.
 */
export async function routeAdmin(
  request: Request,
  env: AdminWorkerEnv,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/admin')) return null

  if (!env.DB) {
    return jsonError(500, 'server_error', '数据库未配置')
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { Allow: 'GET, POST, PUT, OPTIONS' },
    })
  }

  if (pathname === '/api/admin/users') {
    if (request.method !== 'GET') {
      return jsonError(405, 'method_not_allowed', '不支持的请求方法')
    }
    return handleAdminUsersSearch(request, env)
  }

  if (pathname === '/api/admin/usage/summary') {
    if (request.method !== 'GET') {
      return jsonError(405, 'method_not_allowed', '不支持的请求方法')
    }
    return handleAdminUsageSummary(request, env)
  }

  if (pathname === '/api/admin/circuit') {
    if (request.method === 'GET') return handleAdminCircuitGet(request, env)
    if (request.method === 'POST') return handleAdminCircuitSet(request, env)
    return jsonError(405, 'method_not_allowed', '不支持的请求方法')
  }

  if (pathname === '/api/admin/config/image-quota') {
    if (request.method === 'GET') return handleAdminImageQuotaGet(request, env)
    if (request.method === 'POST') return handleAdminImageQuotaSet(request, env)
    return jsonError(405, 'method_not_allowed', '不支持的请求方法')
  }

  if (pathname === '/api/admin/allowlist') {
    if (request.method === 'GET') return handleAdminAllowlistGet(request, env)
    if (request.method === 'PUT') return handleAdminAllowlistPut(request, env)
    return jsonError(405, 'method_not_allowed', '不支持的请求方法')
  }

  const userAction = pathname.match(
    /^\/api\/admin\/users\/([^/]+)\/(ban|unban|quota|role)$/,
  )
  if (userAction) {
    const userId = decodeURIComponent(userAction[1])
    const action = userAction[2]
    if (request.method !== 'POST') {
      return jsonError(405, 'method_not_allowed', '不支持的请求方法')
    }
    if (action === 'ban') return handleAdminBan(request, env, userId)
    if (action === 'unban') return handleAdminUnban(request, env, userId)
    if (action === 'quota') return handleAdminQuota(request, env, userId)
    if (action === 'role') return handleAdminRole(request, env, userId)
  }

  return jsonError(404, 'not_found', '接口不存在')
}
