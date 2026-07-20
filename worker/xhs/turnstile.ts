/** Cloudflare Turnstile siteverify for parse anti-abuse. */

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_token' | 'verify_failed' | 'upstream_error' }

type SiteverifyResponse = {
  success?: boolean
  'error-codes'?: string[]
}

/**
 * Verify a Turnstile token with Cloudflare.
 * Call only when TURNSTILE_SECRET is configured.
 */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  remoteip?: string,
): Promise<TurnstileVerifyResult> {
  const trimmed = token.trim()
  if (!trimmed) {
    return { ok: false, reason: 'missing_token' }
  }

  const body = new URLSearchParams()
  body.set('secret', secret)
  body.set('response', trimmed)
  if (remoteip) body.set('remoteip', remoteip)

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      return { ok: false, reason: 'upstream_error' }
    }
    const data = (await response.json()) as SiteverifyResponse
    if (data.success === true) {
      return { ok: true }
    }
    return { ok: false, reason: 'verify_failed' }
  } catch {
    return { ok: false, reason: 'upstream_error' }
  }
}
