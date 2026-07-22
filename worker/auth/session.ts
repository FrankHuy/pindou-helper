/** Opaque session cookie `pd_session` — D1 stores SHA-256 of secret only. */

import { newId, randomBase64Url, sha256Base64Url } from './crypto'
import type { SessionRow, UserRow } from '../db/types'

export const SESSION_COOKIE = 'pd_session'
/** 30 days */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type AuthEnv = {
  DB: D1Database
}

export function readSessionSecret(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (rawKey === SESSION_COOKIE) {
      const value = rest.join('=').trim()
      return value || null
    }
  }
  return null
}

export function buildSessionCookie(
  secret: string,
  expiresAt: number,
  requestUrl: URL,
): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  const secure = requestUrl.protocol === 'https:'
  const parts = [
    `${SESSION_COOKIE}=${secret}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie(requestUrl: URL): string {
  const secure = requestUrl.protocol === 'https:'
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export async function createSession(
  db: D1Database,
  userId: string,
  meta: { ip?: string | null; fpHash?: string | null },
): Promise<{ secret: string; expiresAt: number }> {
  const secret = randomBase64Url(32)
  const tokenHash = await sha256Base64Url(secret)
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS
  const id = newId()
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_ip, created_fp_hash, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(id, userId, tokenHash, expiresAt, meta.ip ?? null, meta.fpHash ?? null, now)
    .run()
  return { secret, expiresAt }
}

export async function revokeSessionBySecret(db: D1Database, secret: string): Promise<void> {
  const tokenHash = await sha256Base64Url(secret)
  const now = Date.now()
  await db
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(now, tokenHash)
    .run()
}

export async function revokeAllUserSessions(db: D1Database, userId: string): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, userId)
    .run()
}

export type SessionUser = {
  session: SessionRow
  user: UserRow
}

export async function resolveSessionUser(
  db: D1Database,
  request: Request,
): Promise<SessionUser | null> {
  const secret = readSessionSecret(request)
  if (!secret) return null
  const tokenHash = await sha256Base64Url(secret)
  const now = Date.now()
  const row = await db
    .prepare(
      `SELECT
         s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
         s.expires_at AS s_expires_at, s.created_ip AS s_created_ip,
         s.created_fp_hash AS s_created_fp_hash, s.revoked_at AS s_revoked_at,
         s.created_at AS s_created_at,
         u.id AS u_id, u.email AS u_email, u.email_domain AS u_email_domain,
         u.password_hash AS u_password_hash, u.password_salt AS u_password_salt,
         u.password_iters AS u_password_iters, u.email_verified_at AS u_email_verified_at,
         u.role AS u_role, u.plan AS u_plan, u.banned_at AS u_banned_at,
         u.ban_reason AS u_ban_reason, u.daily_quota_override AS u_daily_quota_override,
         u.created_at AS u_created_at, u.updated_at AS u_updated_at
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<Record<string, unknown>>()

  if (!row) return null

  const session: SessionRow = {
    id: String(row.s_id),
    user_id: String(row.s_user_id),
    token_hash: String(row.s_token_hash),
    expires_at: Number(row.s_expires_at),
    created_ip: row.s_created_ip == null ? null : String(row.s_created_ip),
    created_fp_hash: row.s_created_fp_hash == null ? null : String(row.s_created_fp_hash),
    revoked_at: row.s_revoked_at == null ? null : Number(row.s_revoked_at),
    created_at: Number(row.s_created_at),
  }

  const user: UserRow = {
    id: String(row.u_id),
    email: String(row.u_email),
    email_domain: String(row.u_email_domain),
    password_hash: String(row.u_password_hash),
    password_salt: String(row.u_password_salt),
    password_iters: Number(row.u_password_iters),
    email_verified_at: row.u_email_verified_at == null ? null : Number(row.u_email_verified_at),
    role: row.u_role as UserRow['role'],
    plan: row.u_plan as UserRow['plan'],
    banned_at: row.u_banned_at == null ? null : Number(row.u_banned_at),
    ban_reason: row.u_ban_reason == null ? null : String(row.u_ban_reason),
    daily_quota_override:
      row.u_daily_quota_override == null ? null : Number(row.u_daily_quota_override),
    created_at: Number(row.u_created_at),
    updated_at: Number(row.u_updated_at),
  }

  return { session, user }
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
    emailVerified: user.email_verified_at != null,
    banned: user.banned_at != null,
    createdAt: user.created_at,
  }
}
