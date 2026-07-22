import { useCallback, useEffect, useState } from 'react'
import type { MeResponse, PublicUser } from './authApi'
import { AuthRequestError, fetchMe, logoutAccount, pingAi } from './authApi'
import './auth.css'

type AuthSessionBarProps = {
  onLogin: () => void
  /** Open mini admin when role allows. */
  onAdmin?: () => void
  /** Increment to force refresh after auth pages. */
  refreshToken?: number
  onUserChange?: (user: PublicUser | null) => void
}

function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'super_admin'
}

export default function AuthSessionBar({
  onLogin,
  onAdmin,
  refreshToken = 0,
  onUserChange,
}: AuthSessionBarProps) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pingNote, setPingNote] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchMe(signal)
      setMe(data)
      onUserChange?.(data?.user ?? null)
    } catch {
      setMe(null)
      onUserChange?.(null)
    } finally {
      setLoading(false)
    }
  }, [onUserChange])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshToken])

  const logout = async () => {
    setBusy(true)
    setPingNote(null)
    try {
      await logoutAccount()
      setMe(null)
      onUserChange?.(null)
    } catch {
      // still clear local view
      setMe(null)
      onUserChange?.(null)
    } finally {
      setBusy(false)
    }
  }

  const onPing = async () => {
    setBusy(true)
    setPingNote(null)
    try {
      const result = await pingAi()
      setPingNote(`AI 探测 OK · 剩余 ${result.remaining.user}/${result.remaining.userLimit}`)
      await load()
    } catch (err) {
      if (err instanceof AuthRequestError) {
        setPingNote(err.message)
      } else {
        setPingNote('AI 探测失败')
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="auth-session">
        <span className="auth-session-email">…</span>
      </div>
    )
  }

  if (!me?.user) {
    return (
      <div className="auth-session">
        <button type="button" className="auth-session-link" onClick={onLogin}>
          登录
        </button>
      </div>
    )
  }

  const quotaTitle = me.quota.circuitOpen
    ? '全局熔断中'
    : `今日配额 ${me.quota.dailyRemaining}/${me.quota.dailyLimit}`

  return (
    <div className="auth-session">
      <span className="auth-session-email" title={me.user.email}>
        {me.user.email}
      </span>
      {!me.user.emailVerified && (
        <span className="auth-session-badge" title="验证邮箱后可使用 AI">
          未验证
        </span>
      )}
      <span className="auth-session-quota" title={quotaTitle}>
        {me.quota.circuitOpen ? '熔断' : `${me.quota.dailyRemaining}/${me.quota.dailyLimit}`}
      </span>
      {onAdmin && isAdminRole(me.user.role) && (
        <button type="button" className="auth-session-btn" onClick={onAdmin} title="极简管理">
          管理
        </button>
      )}
      <button
        type="button"
        className="auth-session-btn"
        onClick={() => void onPing()}
        disabled={busy}
        title="调用 POST /api/ai/ping 测试配额护栏"
      >
        AI 探测
      </button>
      <button
        type="button"
        className="auth-session-btn"
        onClick={() => void logout()}
        disabled={busy}
      >
        退出
      </button>
      {pingNote && (
        <span className="auth-session-note" title={pingNote}>
          {pingNote}
        </span>
      )}
    </div>
  )
}
