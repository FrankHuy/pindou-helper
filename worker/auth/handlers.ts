/**
 * Auth HTTP handlers: register / login / logout / verify / reset / me.
 * AI cost guard: worker/guard/*; /api/me exposes full quota snapshot.
 */

import { getConfigInt, getEmailDomainAllowlist, isDomainAllowed } from '../db/config'
import type { UserRow } from '../db/types'
import { incrementUsage, isUnderCap } from '../db/usage'
import { buildQuotaSnapshot } from '../guard/requireAiAccess'
import { verifyTurnstileToken } from '../xhs/turnstile'
import { newId, sha256Base64Url } from './crypto'
import {
  clientIp,
  emailDomain,
  jsonError,
  jsonOk,
  normalizeEmail,
  readClientFp,
  readJsonBody,
  requestOrigin,
} from './http'
import {
  buildResetEmail,
  buildVerifyEmail,
  mailFailPublicFields,
  sendAuthEmail,
} from './mail'
import {
  hashPassword,
  resolvePbkdf2Iterations,
  validatePasswordPolicy,
  verifyPassword,
} from './password'
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  publicUser,
  readSessionSecret,
  resolveSessionUser,
  revokeAllUserSessions,
  revokeSessionBySecret,
} from './session'
import {
  consumeEmailToken,
  findValidEmailToken,
  issueEmailToken,
  RESET_TTL_MS,
  VERIFY_TTL_MS,
} from './tokens'

export type AuthWorkerEnv = {
  DB: D1Database
  TURNSTILE_SECRET?: string
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  BOOTSTRAP_SUPERADMIN_EMAIL?: string
  PASSWORD_PBKDF2_ITERATIONS?: string
}

async function requireTurnstile(
  env: AuthWorkerEnv,
  request: Request,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const secret = env.TURNSTILE_SECRET?.trim()
  if (!secret) return null
  const token =
    typeof body.turnstileToken === 'string'
      ? body.turnstileToken
      : typeof body.cfTurnstileResponse === 'string'
        ? body.cfTurnstileResponse
        : ''
  const verified = await verifyTurnstileToken(secret, token, clientIp(request))
  if (!verified.ok) {
    const message =
      verified.reason === 'missing_token'
        ? '请完成人机验证'
        : '人机验证失败，请刷新验证后重试'
    return jsonError(403, 'turnstile_failed', message)
  }
  return null
}

async function loadUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, email, email_domain, password_hash, password_salt, password_iters,
              email_verified_at, role, plan, banned_at, ban_reason, daily_quota_override,
              created_at, updated_at
       FROM users WHERE email = ? LIMIT 1`,
    )
    .bind(email)
    .first<UserRow>()
}

async function loadUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, email, email_domain, password_hash, password_salt, password_iters,
              email_verified_at, role, plan, banned_at, ban_reason, daily_quota_override,
              created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<UserRow>()
}

function withSessionCookie(
  response: Response,
  secret: string,
  expiresAt: number,
  request: Request,
): Response {
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', buildSessionCookie(secret, expiresAt, new URL(request.url)))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function withClearedCookie(response: Response, request: Request): Response {
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', clearSessionCookie(new URL(request.url)))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function handleRegister(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const turnstileErr = await requireTurnstile(env, request, body)
  if (turnstileErr) return turnstileErr

  const email = normalizeEmail(body.email)
  if (!email) return jsonError(400, 'invalid_email', '请输入有效邮箱')

  const password = typeof body.password === 'string' ? body.password : ''
  const policy = validatePasswordPolicy(password)
  if (policy) return jsonError(400, 'invalid_password', policy)

  const domain = emailDomain(email)
  const allowlist = await getEmailDomainAllowlist(env.DB)
  if (!isDomainAllowed(domain, allowlist)) {
    console.info('[auth] register_reject', { reason: 'domain_not_allowed', domain })
    return jsonError(400, 'domain_not_allowed', '该邮箱域名不在允许列表中')
  }

  const fpRaw = readClientFp(request, body)
  if (!fpRaw || fpRaw.length < 8) {
    return jsonError(400, 'fp_required', '缺少浏览器指纹，请刷新页面后重试')
  }
  const fpHash = await sha256Base64Url(fpRaw)
  const ip = clientIp(request)

  const registerIpCap = await getConfigInt(env.DB, 'register_ip_daily_cap', 3)
  const registerFpCap = await getConfigInt(env.DB, 'register_fp_daily_cap', 2)

  const ipCap = await isUnderCap(env.DB, 'register_ip', ip, registerIpCap)
  if (!ipCap.ok) {
    console.info('[auth] register_reject', { reason: 'register_ip_cap', ip })
    return jsonError(429, 'register_cap', '当前网络注册次数已达上限，请明日再试')
  }
  const fpCap = await isUnderCap(env.DB, 'register_fp', fpHash, registerFpCap)
  if (!fpCap.ok) {
    console.info('[auth] register_reject', { reason: 'register_fp_cap' })
    return jsonError(429, 'register_cap', '当前设备注册次数已达上限，请明日再试')
  }

  const existing = await loadUserByEmail(env.DB, email)
  if (existing) {
    return jsonError(409, 'email_taken', '该邮箱已注册，请直接登录')
  }

  const bootstrap = env.BOOTSTRAP_SUPERADMIN_EMAIL?.trim().toLowerCase()
  const role = bootstrap && email === bootstrap ? 'super_admin' : 'user'

  const iterations = resolvePbkdf2Iterations(env.PASSWORD_PBKDF2_ITERATIONS)
  const pw = await hashPassword(password, iterations)
  const now = Date.now()
  const userId = newId()

  try {
    await env.DB.prepare(
      `INSERT INTO users (
         id, email, email_domain, password_hash, password_salt, password_iters,
         email_verified_at, role, plan, banned_at, ban_reason, daily_quota_override,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'free', NULL, NULL, NULL, ?, ?)`,
    )
      .bind(userId, email, domain, pw.hash, pw.salt, pw.iterations, role, now, now)
      .run()
  } catch (err) {
    // Unique race
    console.info('[auth] register_reject', { reason: 'email_taken_race', err: String(err) })
    return jsonError(409, 'email_taken', '该邮箱已注册，请直接登录')
  }

  await incrementUsage(env.DB, 'register_ip', ip, 1)
  await incrementUsage(env.DB, 'register_fp', fpHash, 1)

  const verifyToken = await issueEmailToken(env.DB, userId, 'verify', VERIFY_TTL_MS)
  const origin = requestOrigin(request)
  const mail = buildVerifyEmail(origin, verifyToken)
  const sent = await sendAuthEmail(env, { to: email, ...mail })
  if (!sent.ok) {
    // User exists; still allow login + resend. Surface soft failure with real reason.
    console.error('[auth] verify mail failed after register', {
      mode: sent.mode,
      message: sent.message,
      origin,
      ...mailFailPublicFields(sent),
    })
  }

  const session = await createSession(env.DB, userId, { ip, fpHash })
  const user = await loadUserById(env.DB, userId)
  const response = jsonOk({
    user: user ? publicUser(user) : null,
    emailSent: sent.ok,
    message: sent.ok
      ? '注册成功，请查收验证邮件（若未看到请检查垃圾箱）'
      : `注册成功，但验证邮件未发出：${sent.message}`,
    hasResendApiKey: sent.probe.hasResendApiKey,
    hasMailFrom: sent.probe.hasMailFrom,
  })
  return withSessionCookie(response, session.secret, session.expiresAt, request)
}

export async function handleLogin(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const turnstileErr = await requireTurnstile(env, request, body)
  if (turnstileErr) return turnstileErr

  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return jsonError(400, 'invalid_request', '请输入邮箱和密码')
  }

  const ip = clientIp(request)
  const failIpCap = await getConfigInt(env.DB, 'auth_fail_ip_daily_cap', 30)
  const failEmailCap = await getConfigInt(env.DB, 'auth_fail_email_daily_cap', 15)

  const ipFails = await isUnderCap(env.DB, 'auth_fail_ip', ip, failIpCap)
  if (!ipFails.ok) {
    return jsonError(429, 'rate_limited', '尝试次数过多，请稍后再试')
  }
  const emailFails = await isUnderCap(env.DB, 'auth_fail_email', email, failEmailCap)
  if (!emailFails.ok) {
    return jsonError(429, 'rate_limited', '尝试次数过多，请稍后再试')
  }

  const user = await loadUserByEmail(env.DB, email)
  // Always run PBKDF2 so missing vs wrong-password responses have similar cost
  // (reduces email-enumeration timing signal).
  const dummy: { hash: string; salt: string; iterations: number } = {
    hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA',
    iterations: resolvePbkdf2Iterations(env.PASSWORD_PBKDF2_ITERATIONS),
  }
  const record = user
    ? {
        hash: user.password_hash,
        salt: user.password_salt,
        iterations: user.password_iters,
      }
    : dummy
  const passwordOk = await verifyPassword(password, record)
  const ok = user != null && passwordOk

  if (!ok || !user) {
    await incrementUsage(env.DB, 'auth_fail_ip', ip, 1)
    await incrementUsage(env.DB, 'auth_fail_email', email, 1)
    console.info('[auth] auth_fail', { reason: 'bad_credentials' })
    return jsonError(401, 'auth_failed', '邮箱或密码错误')
  }

  if (user.banned_at != null) {
    return jsonError(403, 'banned', user.ban_reason?.trim() || '账号已被封禁')
  }

  const fpRaw = readClientFp(request, body)
  const fpHash = fpRaw ? await sha256Base64Url(fpRaw) : null
  const session = await createSession(env.DB, user.id, { ip, fpHash })
  const response = jsonOk({
    user: publicUser(user),
    message: '登录成功',
  })
  return withSessionCookie(response, session.secret, session.expiresAt, request)
}

export async function handleLogout(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const secret = readSessionSecret(request)
  if (secret) {
    await revokeSessionBySecret(env.DB, secret)
  }
  return withClearedCookie(jsonOk({ ok: true, message: '已退出登录' }), request)
}

export async function handleVerify(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const token = typeof parsed.body.token === 'string' ? parsed.body.token.trim() : ''
  if (!token) return jsonError(400, 'invalid_request', '缺少验证令牌')

  const found = await findValidEmailToken(env.DB, token, 'verify')
  if (!found.ok) {
    if (found.reason === 'expired') {
      return jsonError(400, 'token_expired', '验证链接已过期，请重新发送')
    }
    return jsonError(400, 'token_invalid', '验证链接无效或已使用')
  }

  const now = Date.now()
  await consumeEmailToken(env.DB, found.row.id)
  await env.DB.prepare(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
  )
    .bind(now, now, found.row.user_id)
    .run()

  // Bootstrap superadmin on verify if env matches (also set at register).
  const user = await loadUserById(env.DB, found.row.user_id)
  if (user) {
    const bootstrap = env.BOOTSTRAP_SUPERADMIN_EMAIL?.trim().toLowerCase()
    if (bootstrap && user.email === bootstrap && user.role !== 'super_admin') {
      await env.DB.prepare(`UPDATE users SET role = 'super_admin', updated_at = ? WHERE id = ?`)
        .bind(now, user.id)
        .run()
      user.role = 'super_admin'
    }
  }

  const refreshed = user ? await loadUserById(env.DB, user.id) : null
  return jsonOk({
    user: refreshed ? publicUser(refreshed) : null,
    message: '邮箱验证成功',
  })
}

export async function handleResendVerify(
  request: Request,
  env: AuthWorkerEnv,
): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  // Prefer session user; allow email body for logged-out resend.
  const sessionUser = await resolveSessionUser(env.DB, request)
  let user: UserRow | null = sessionUser?.user ?? null
  if (!user) {
    const email = normalizeEmail(body.email)
    if (!email) return jsonError(400, 'invalid_email', '请输入邮箱')
    // Turnstile when not session-authenticated to limit abuse.
    const turnstileErr = await requireTurnstile(env, request, body)
    if (turnstileErr) return turnstileErr
    user = await loadUserByEmail(env.DB, email)
  }

  // Always generic success to avoid email enumeration when unauthenticated.
  const generic = jsonOk({ ok: true, message: '若邮箱已注册且未验证，将收到验证邮件' })

  if (!user) return generic
  if (user.email_verified_at != null) {
    return jsonOk({ ok: true, message: '邮箱已验证，无需重复发送' })
  }

  const verifyToken = await issueEmailToken(env.DB, user.id, 'verify', VERIFY_TTL_MS)
  const mail = buildVerifyEmail(requestOrigin(request), verifyToken)
  const sent = await sendAuthEmail(env, { to: user.email, ...mail })
  if (!sent.ok) {
    return Response.json(
      {
        error: 'mail_failed',
        message: sent.message,
        ...mailFailPublicFields(sent),
      },
      { status: 502 },
    )
  }
  return jsonOk({
    ok: true,
    message: '验证邮件已发送，请查收',
    hasResendApiKey: sent.probe.hasResendApiKey,
    hasMailFrom: sent.probe.hasMailFrom,
  })
}

export async function handleForgot(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const turnstileErr = await requireTurnstile(env, request, body)
  if (turnstileErr) return turnstileErr

  const email = normalizeEmail(body.email)
  if (!email) return jsonError(400, 'invalid_email', '请输入有效邮箱')

  const generic = jsonOk({
    ok: true,
    message: '若邮箱已注册，将收到重置密码邮件',
  })

  const user = await loadUserByEmail(env.DB, email)
  if (!user || user.banned_at != null) return generic

  const token = await issueEmailToken(env.DB, user.id, 'reset', RESET_TTL_MS)
  const mail = buildResetEmail(requestOrigin(request), token)
  const sent = await sendAuthEmail(env, { to: user.email, ...mail })
  if (!sent.ok) {
    // Still generic to client; log for ops.
    console.error('[auth] reset mail failed', sent.message)
  }
  return generic
}

export async function handleReset(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!token) return jsonError(400, 'invalid_request', '缺少重置令牌')
  const policy = validatePasswordPolicy(password)
  if (policy) return jsonError(400, 'invalid_password', policy)

  const found = await findValidEmailToken(env.DB, token, 'reset')
  if (!found.ok) {
    if (found.reason === 'expired') {
      return jsonError(400, 'token_expired', '重置链接已过期，请重新申请')
    }
    return jsonError(400, 'token_invalid', '重置链接无效或已使用')
  }

  const user = await loadUserById(env.DB, found.row.user_id)
  if (!user) return jsonError(400, 'token_invalid', '重置链接无效或已使用')
  if (user.banned_at != null) {
    return jsonError(403, 'banned', '账号已被封禁')
  }

  const iterations = resolvePbkdf2Iterations(env.PASSWORD_PBKDF2_ITERATIONS)
  const pw = await hashPassword(password, iterations)
  const now = Date.now()
  await consumeEmailToken(env.DB, found.row.id)
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(pw.hash, pw.salt, pw.iterations, now, user.id)
    .run()

  // Revoke all sessions after password change.
  await revokeAllUserSessions(env.DB, user.id)

  const ip = clientIp(request)
  const session = await createSession(env.DB, user.id, { ip, fpHash: null })
  const refreshed = await loadUserById(env.DB, user.id)
  const response = jsonOk({
    user: refreshed ? publicUser(refreshed) : null,
    message: '密码已重置',
  })
  return withSessionCookie(response, session.secret, session.expiresAt, request)
}

export async function handleMe(request: Request, env: AuthWorkerEnv): Promise<Response> {
  const sessionUser = await resolveSessionUser(env.DB, request)
  if (!sessionUser) {
    return jsonError(401, 'auth_required', '未登录')
  }
  const { user } = sessionUser
  if (user.banned_at != null) {
    // Session still present but account banned — clear cookie.
    return withClearedCookie(
      jsonError(403, 'banned', user.ban_reason?.trim() || '账号已被封禁'),
      request,
    )
  }

  const ip = clientIp(request)
  const fpRaw = readClientFp(request)
  const fpHash = fpRaw ? await sha256Base64Url(fpRaw) : null
  const snap = await buildQuotaSnapshot(env.DB, user, { ip, fpHash })

  return jsonOk({
    user: publicUser(user),
    quota: {
      dailyLimit: snap.userLimit,
      dailyUsed: snap.userUsed,
      dailyRemaining: snap.userRemaining,
      globalLimit: snap.globalLimit,
      globalUsed: snap.globalUsed,
      globalRemaining: snap.globalRemaining,
      associateLimit: snap.associateLimit,
      circuitOpen: snap.circuitOpen,
      emailVerified: snap.emailVerified,
      day: snap.day,
    },
  })
}
