/** One-time email tokens (verify / reset) — store hash only. */

import { newId, randomBase64Url, sha256Base64Url } from './crypto'
import type { EmailTokenPurpose, EmailTokenRow } from '../db/types'

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
export const RESET_TTL_MS = 60 * 60 * 1000

export async function issueEmailToken(
  db: D1Database,
  userId: string,
  purpose: EmailTokenPurpose,
  ttlMs: number,
): Promise<string> {
  // Invalidate outstanding tokens of the same purpose.
  const now = Date.now()
  await db
    .prepare(
      `UPDATE email_tokens SET consumed_at = ?
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
    )
    .bind(now, userId, purpose)
    .run()

  const secret = randomBase64Url(32)
  const tokenHash = await sha256Base64Url(secret)
  const id = newId()
  await db
    .prepare(
      `INSERT INTO email_tokens (id, purpose, token_hash, user_id, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(id, purpose, tokenHash, userId, now + ttlMs, now)
    .run()
  return secret
}

export type ConsumedToken = {
  row: EmailTokenRow
}

export async function findValidEmailToken(
  db: D1Database,
  secret: string,
  purpose: EmailTokenPurpose,
): Promise<
  | { ok: true; row: EmailTokenRow }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' }
> {
  const tokenHash = await sha256Base64Url(secret)
  const row = await db
    .prepare(
      `SELECT id, purpose, token_hash, user_id, expires_at, consumed_at, created_at
       FROM email_tokens WHERE token_hash = ? AND purpose = ? LIMIT 1`,
    )
    .bind(tokenHash, purpose)
    .first<EmailTokenRow>()

  if (!row) return { ok: false, reason: 'invalid' }
  if (row.consumed_at != null) return { ok: false, reason: 'consumed' }
  if (row.expires_at <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, row }
}

export async function consumeEmailToken(db: D1Database, tokenId: string): Promise<void> {
  await db
    .prepare(`UPDATE email_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
    .bind(Date.now(), tokenId)
    .run()
}
