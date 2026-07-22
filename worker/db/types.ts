/** Shared D1 row types for auth + usage (Phase 1). */

export type UserRole = 'user' | 'vip' | 'admin' | 'super_admin'
export type UserPlan = 'free' | 'vip'

export type UserRow = {
  id: string
  email: string
  email_domain: string
  password_hash: string
  password_salt: string
  password_iters: number
  email_verified_at: number | null
  role: UserRole
  plan: UserPlan
  banned_at: number | null
  ban_reason: string | null
  daily_quota_override: number | null
  created_at: number
  updated_at: number
}

export type SessionRow = {
  id: string
  user_id: string
  token_hash: string
  expires_at: number
  created_ip: string | null
  created_fp_hash: string | null
  revoked_at: number | null
  created_at: number
}

export type EmailTokenPurpose = 'verify' | 'reset'

export type EmailTokenRow = {
  id: string
  purpose: EmailTokenPurpose
  token_hash: string
  user_id: string
  expires_at: number
  consumed_at: number | null
  created_at: number
}

/** AI associate counters: user | ip | fp | global.
 *  Register / auth-fail counters use dedicated types to avoid mixing with AI usage. */
export type UsageSubjectType =
  | 'user'
  | 'ip'
  | 'fp'
  | 'global'
  | 'register_ip'
  | 'register_fp'
  | 'auth_fail_ip'
  | 'auth_fail_email'
