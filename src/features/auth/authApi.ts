/** Same-origin auth client with credentials include. */

import { getClientFingerprint } from './fingerprint'

export type PublicUser = {
  id: string
  email: string
  role: string
  plan: string
  emailVerified: boolean
  banned: boolean
  createdAt: number
}

export type MeResponse = {
  user: PublicUser
  quota: {
    dailyLimit: number
    dailyUsed: number
    dailyRemaining: number
    globalLimit?: number
    globalUsed?: number
    globalRemaining?: number
    associateLimit?: number
    circuitOpen?: boolean
    emailVerified: boolean
    day?: string
  }
}

export type AiPingResponse = {
  ok: true
  message: string
  remaining: {
    day: string
    user: number
    userLimit: number
    userUsed: number
    global: number
    associateLimit: number
    circuitOpen: boolean
  }
}

export type AuthApiError = {
  error: string
  message: string
}

export class AuthRequestError extends Error {
  error: string
  status: number

  constructor(status: number, error: string, message: string) {
    super(message)
    this.name = 'AuthRequestError'
    this.status = status
    this.error = error
  }
}

async function parseError(response: Response): Promise<AuthRequestError> {
  try {
    const data = (await response.json()) as Partial<AuthApiError>
    return new AuthRequestError(
      response.status,
      typeof data.error === 'string' ? data.error : 'server_error',
      typeof data.message === 'string' ? data.message : '请求失败',
    )
  } catch {
    return new AuthRequestError(response.status, 'server_error', '请求失败')
  }
}

async function authFetch<T>(
  path: string,
  init: RequestInit & { json?: Record<string, unknown> } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  const fp = getClientFingerprint()
  headers.set('X-Client-Fp', fp)

  let body = init.body
  if (init.json) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify({
      ...init.json,
      fingerprint: fp,
    })
  }

  const response = await fetch(path, {
    ...init,
    headers,
    body,
    credentials: 'include',
  })

  if (!response.ok) {
    throw await parseError(response)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse | null> {
  try {
    return await authFetch<MeResponse>('/api/me', { method: 'GET', signal })
  } catch (err) {
    if (err instanceof AuthRequestError && (err.status === 401 || err.error === 'auth_required')) {
      return null
    }
    throw err
  }
}

export async function registerAccount(input: {
  email: string
  password: string
  turnstileToken?: string
}): Promise<{
  user: PublicUser | null
  message: string
  emailSent?: boolean
  mailMode?: string
}> {
  return authFetch('/api/auth/register', {
    method: 'POST',
    json: {
      email: input.email,
      password: input.password,
      turnstileToken: input.turnstileToken ?? '',
    },
  })
}

export async function loginAccount(input: {
  email: string
  password: string
  turnstileToken?: string
}): Promise<{ user: PublicUser; message: string }> {
  return authFetch('/api/auth/login', {
    method: 'POST',
    json: {
      email: input.email,
      password: input.password,
      turnstileToken: input.turnstileToken ?? '',
    },
  })
}

export async function logoutAccount(): Promise<void> {
  await authFetch('/api/auth/logout', { method: 'POST', json: {} })
}

export async function verifyEmailToken(token: string): Promise<{ user: PublicUser | null; message: string }> {
  return authFetch('/api/auth/verify', {
    method: 'POST',
    json: { token },
  })
}

export async function resendVerify(input?: {
  email?: string
  turnstileToken?: string
}): Promise<{ message: string }> {
  return authFetch('/api/auth/resend-verify', {
    method: 'POST',
    json: {
      email: input?.email ?? '',
      turnstileToken: input?.turnstileToken ?? '',
    },
  })
}

export async function forgotPassword(input: {
  email: string
  turnstileToken?: string
}): Promise<{ message: string }> {
  return authFetch('/api/auth/forgot', {
    method: 'POST',
    json: {
      email: input.email,
      turnstileToken: input.turnstileToken ?? '',
    },
  })
}

export async function resetPassword(input: {
  token: string
  password: string
}): Promise<{ user: PublicUser | null; message: string }> {
  return authFetch('/api/auth/reset', {
    method: 'POST',
    json: {
      token: input.token,
      password: input.password,
    },
  })
}

/** Stub AI ping for manual quota-guard testing. */
export async function pingAi(): Promise<AiPingResponse> {
  return authFetch('/api/ai/ping', {
    method: 'POST',
    json: {},
  })
}
