/** Shared JSON helpers + request parsing for auth routes. */

export type AuthErrorCode =
  | 'invalid_request'
  | 'invalid_email'
  | 'invalid_password'
  | 'domain_not_allowed'
  | 'fp_required'
  | 'turnstile_failed'
  | 'register_cap'
  | 'email_taken'
  | 'auth_failed'
  | 'banned'
  | 'rate_limited'
  | 'auth_required'
  | 'token_invalid'
  | 'token_expired'
  | 'not_found'
  | 'method_not_allowed'
  | 'server_error'
  | 'mail_failed'

export function jsonError(
  status: number,
  error: AuthErrorCode | string,
  message: string,
): Response {
  return Response.json({ error, message }, { status })
}

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store')
  return Response.json(data, { ...init, headers })
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const data = await request.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        response: jsonError(400, 'invalid_request', '请求体必须是 JSON 对象'),
      }
    }
    return { ok: true, body: data as Record<string, unknown> }
  } catch {
    return {
      ok: false,
      response: jsonError(400, 'invalid_request', '请求体必须是 JSON'),
    }
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP')?.trim() ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  )
}

export function readClientFp(request: Request, body?: Record<string, unknown>): string | null {
  const header = request.headers.get('X-Client-Fp')?.trim()
  if (header) return header
  if (body && typeof body.fingerprint === 'string' && body.fingerprint.trim()) {
    return body.fingerprint.trim()
  }
  if (body && typeof body.fp === 'string' && body.fp.trim()) {
    return body.fp.trim()
  }
  return null
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  // Practical email shape; domain allowlist is the real gate.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null
  return email
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase() : ''
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  return url.origin
}
