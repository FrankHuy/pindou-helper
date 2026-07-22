/** Same-origin admin client (credentials include). */

export type AdminUser = {
  id: string
  email: string
  emailDomain: string
  role: string
  plan: string
  emailVerified: boolean
  banned: boolean
  banReason: string | null
  dailyQuotaOverride: number | null
  createdAt: number
  updatedAt: number
}

export type UsageSummary = {
  day: string
  circuitOpen: boolean
  global: { used: number; limit: number; remaining: number }
  defaultDailyQuota: number
  associateLimit: number
  topUsers: { id: string; email: string; role: string; count: number }[]
}

export type AdminApiError = {
  error: string
  message: string
}

export class AdminRequestError extends Error {
  error: string
  status: number

  constructor(status: number, error: string, message: string) {
    super(message)
    this.name = 'AdminRequestError'
    this.status = status
    this.error = error
  }
}

async function parseError(response: Response): Promise<AdminRequestError> {
  try {
    const data = (await response.json()) as Partial<AdminApiError>
    return new AdminRequestError(
      response.status,
      typeof data.error === 'string' ? data.error : 'server_error',
      typeof data.message === 'string' ? data.message : '请求失败',
    )
  } catch {
    return new AdminRequestError(response.status, 'server_error', '请求失败')
  }
}

async function adminFetch<T>(
  path: string,
  init: RequestInit & { json?: Record<string, unknown> } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
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

export async function searchAdminUsers(
  q: string,
  signal?: AbortSignal,
): Promise<{ users: AdminUser[]; q: string; limit: number }> {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  const qs = params.toString()
  return adminFetch(`/api/admin/users${qs ? `?${qs}` : ''}`, { method: 'GET', signal })
}

export async function banUser(
  userId: string,
  reason?: string,
): Promise<{ user: AdminUser | null; message: string }> {
  return adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: 'POST',
    json: { reason: reason ?? '' },
  })
}

export async function unbanUser(
  userId: string,
): Promise<{ user: AdminUser | null; message: string }> {
  return adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/unban`, {
    method: 'POST',
    json: {},
  })
}

export async function setUserQuota(
  userId: string,
  dailyQuotaOverride: number | null,
): Promise<{ user: AdminUser | null; message: string }> {
  return adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/quota`, {
    method: 'POST',
    json: { dailyQuotaOverride },
  })
}

export async function setUserRole(
  userId: string,
  role: string,
): Promise<{ user: AdminUser | null; message: string }> {
  return adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'POST',
    json: { role },
  })
}

export async function fetchUsageSummary(signal?: AbortSignal): Promise<UsageSummary> {
  return adminFetch('/api/admin/usage/summary', { method: 'GET', signal })
}

export async function fetchCircuit(signal?: AbortSignal): Promise<{ open: boolean }> {
  return adminFetch('/api/admin/circuit', { method: 'GET', signal })
}

export async function setCircuit(open: boolean): Promise<{ open: boolean; message: string }> {
  return adminFetch('/api/admin/circuit', {
    method: 'POST',
    json: { open },
  })
}

export async function fetchAllowlist(signal?: AbortSignal): Promise<{ domains: string[] }> {
  return adminFetch('/api/admin/allowlist', { method: 'GET', signal })
}

export async function putAllowlist(
  domains: string[],
): Promise<{ domains: string[]; message: string }> {
  return adminFetch('/api/admin/allowlist', {
    method: 'PUT',
    json: { domains },
  })
}

export function isAdminRole(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'super_admin'
}

export function isSuperAdminRole(role: string | undefined | null): boolean {
  return role === 'super_admin'
}
