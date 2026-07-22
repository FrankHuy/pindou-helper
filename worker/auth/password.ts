/**
 * PBKDF2-SHA-256 password hashing via Web Crypto (Workers-supported).
 *
 * Risk: Cloudflare Workers Free plan has a ~10ms CPU limit; strong iteration
 * counts may time out. Prefer Workers Paid for production auth, or lower
 * PASSWORD_PBKDF2_ITERATIONS with documented risk (default 100_000).
 */

import { bytesToBase64Url, timingSafeEqualString } from './crypto'

const textEncoder = new TextEncoder()

/** Default iterations — tune via env PASSWORD_PBKDF2_ITERATIONS. */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000

export function resolvePbkdf2Iterations(envValue?: string): number {
  if (!envValue?.trim()) return DEFAULT_PBKDF2_ITERATIONS
  const n = Number.parseInt(envValue.trim(), 10)
  if (!Number.isFinite(n) || n < 10_000) return DEFAULT_PBKDF2_ITERATIONS
  // Cap to avoid accidental multi-second derives.
  return Math.min(n, 600_000)
}

export type PasswordRecord = {
  hash: string
  salt: string
  iterations: number
}

export async function hashPassword(
  password: string,
  iterations: number,
): Promise<PasswordRecord> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, saltBytes, iterations)
  return {
    hash: bytesToBase64Url(hash),
    salt: bytesToBase64Url(saltBytes),
    iterations,
  }
}

export async function verifyPassword(
  password: string,
  record: PasswordRecord,
): Promise<boolean> {
  const saltBytes = base64UrlToBytes(record.salt)
  const derived = await derive(password, saltBytes, record.iterations)
  const derivedB64 = bytesToBase64Url(derived)
  return timingSafeEqualString(derivedB64, record.hash)
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  // Copy into a fresh ArrayBuffer-backed view (avoids SharedArrayBuffer typings).
  const saltCopy = new Uint8Array(salt)
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltCopy,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (padded.length % 4)) % 4
  const b64 = padded + '='.repeat(padLen)
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Basic password policy for register/reset. */
export function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return '密码至少 8 位'
  }
  if (password.length > 128) {
    return '密码过长'
  }
  return null
}
