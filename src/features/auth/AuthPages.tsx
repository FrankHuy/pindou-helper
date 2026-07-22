import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AuthRequestError,
  forgotPassword,
  loginAccount,
  registerAccount,
  resendVerify,
  resetPassword,
  verifyEmailToken,
} from './authApi'
import TurnstileField from './TurnstileField'
import './auth.css'

export type AuthPageId = 'login' | 'register' | 'forgot' | 'reset' | 'verify'

type AuthPagesProps = {
  page: AuthPageId
  onNavigate: (page: AuthPageId | 'app') => void
  onAuthed: () => void
}

function queryToken(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? ''
}

function AuthShell({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: ReactNode
}) {
  return (
    <div className="auth-page">
      <header className="auth-topbar">
        <button type="button" className="auth-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  )
}

function LoginForm({
  onNavigate,
  onAuthed,
}: {
  onNavigate: AuthPagesProps['onNavigate']
  onAuthed: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [resetTs, setResetTs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const onTokenChange = useCallback((t: string) => setToken(t), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await loginAccount({ email, password, turnstileToken: token })
      onAuthed()
      onNavigate('app')
    } catch (err) {
      setError(err instanceof AuthRequestError ? err.message : '登录失败')
      setResetTs((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h2>登录</h2>
      <p className="auth-lead">使用邮箱与密码登录。未验证邮箱仍可登录，但 AI 能力将锁定。</p>
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        <div className="auth-field">
          <label htmlFor="auth-login-email">邮箱</label>
          <input
            id="auth-login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-login-password">密码</label>
          <input
            id="auth-login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <TurnstileField onTokenChange={onTokenChange} resetSignal={resetTs} />
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
      <div className="auth-links">
        <button type="button" onClick={() => onNavigate('register')}>
          注册账号
        </button>
        <button type="button" onClick={() => onNavigate('forgot')}>
          忘记密码
        </button>
      </div>
    </div>
  )
}

function RegisterForm({
  onNavigate,
  onAuthed,
}: {
  onNavigate: AuthPagesProps['onNavigate']
  onAuthed: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [token, setToken] = useState('')
  const [resetTs, setResetTs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const onTokenChange = useCallback((t: string) => setToken(t), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setInfo('')
    if (password !== password2) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const result = await registerAccount({ email, password, turnstileToken: token })
      setInfo(result.message)
      onAuthed()
      // Stay briefly then home — user may need to verify email later for AI.
      onNavigate('app')
    } catch (err) {
      setError(err instanceof AuthRequestError ? err.message : '注册失败')
      setResetTs((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h2>注册</h2>
      <p className="auth-lead">
        目前仅支持白名单邮箱域名（如 qq.com / gmail.com）。注册后请完成邮箱验证以使用 AI。
      </p>
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        <div className="auth-field">
          <label htmlFor="auth-reg-email">邮箱</label>
          <input
            id="auth-reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-reg-password">密码（至少 8 位）</label>
          <input
            id="auth-reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-reg-password2">确认密码</label>
          <input
            id="auth-reg-password2"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <TurnstileField onTokenChange={onTokenChange} resetSignal={resetTs} />
        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-success">{info}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? '注册中…' : '注册'}
        </button>
      </form>
      <div className="auth-links">
        <button type="button" onClick={() => onNavigate('login')}>
          已有账号？去登录
        </button>
      </div>
    </div>
  )
}

function ForgotForm({ onNavigate }: { onNavigate: AuthPagesProps['onNavigate'] }) {
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [resetTs, setResetTs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const onTokenChange = useCallback((t: string) => setToken(t), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const result = await forgotPassword({ email, turnstileToken: token })
      setInfo(result.message)
      setResetTs((n) => n + 1)
    } catch (err) {
      setError(err instanceof AuthRequestError ? err.message : '发送失败')
      setResetTs((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h2>忘记密码</h2>
      <p className="auth-lead">输入注册邮箱，若账号存在将收到重置链接。</p>
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        <div className="auth-field">
          <label htmlFor="auth-forgot-email">邮箱</label>
          <input
            id="auth-forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <TurnstileField onTokenChange={onTokenChange} resetSignal={resetTs} />
        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-success">{info}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? '发送中…' : '发送重置邮件'}
        </button>
      </form>
      <div className="auth-links">
        <button type="button" onClick={() => onNavigate('login')}>
          返回登录
        </button>
      </div>
    </div>
  )
}

function ResetForm({
  onNavigate,
  onAuthed,
}: {
  onNavigate: AuthPagesProps['onNavigate']
  onAuthed: () => void
}) {
  const initialToken = useMemo(() => queryToken(), [])
  const [token, setToken] = useState(initialToken)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setInfo('')
    if (password !== password2) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const result = await resetPassword({ token, password })
      setInfo(result.message)
      onAuthed()
      onNavigate('app')
    } catch (err) {
      setError(err instanceof AuthRequestError ? err.message : '重置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h2>重置密码</h2>
      <p className="auth-lead">设置新密码后，其他已登录设备将被退出。</p>
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        {!initialToken && (
          <div className="auth-field">
            <label htmlFor="auth-reset-token">重置令牌</label>
            <input
              id="auth-reset-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>
        )}
        <div className="auth-field">
          <label htmlFor="auth-reset-password">新密码（至少 8 位）</label>
          <input
            id="auth-reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-reset-password2">确认新密码</label>
          <input
            id="auth-reset-password2"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
            minLength={8}
          />
        </div>
        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-success">{info}</p>}
        <button className="auth-submit" type="submit" disabled={busy || !token}>
          {busy ? '提交中…' : '确认重置'}
        </button>
      </form>
      <div className="auth-links">
        <button type="button" onClick={() => onNavigate('login')}>
          返回登录
        </button>
      </div>
    </div>
  )
}

function VerifyPanel({
  onNavigate,
  onAuthed,
}: {
  onNavigate: AuthPagesProps['onNavigate']
  onAuthed: () => void
}) {
  const token = useMemo(() => queryToken(), [])
  const [busy, setBusy] = useState(Boolean(token))
  const [error, setError] = useState('')
  const [info, setInfo] = useState(token ? '正在验证…' : '')
  const [email, setEmail] = useState('')
  const [tsToken, setTsToken] = useState('')
  const [resetTs, setResetTs] = useState(0)
  const onTokenChange = useCallback((t: string) => setTsToken(t), [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const result = await verifyEmailToken(token)
        if (cancelled) return
        setInfo(result.message)
        setBusy(false)
        onAuthed()
      } catch (err) {
        if (cancelled) return
        setError(err instanceof AuthRequestError ? err.message : '验证失败')
        setInfo('')
        setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, onAuthed])

  const resend = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const result = await resendVerify({ email, turnstileToken: tsToken })
      setInfo(result.message)
      setResetTs((n) => n + 1)
    } catch (err) {
      setError(err instanceof AuthRequestError ? err.message : '发送失败')
      setResetTs((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <h2>邮箱验证</h2>
      <p className="auth-lead">验证通过后即可使用需登录的 AI 能力（本地图纸工具不受影响）。</p>
      {info && <p className="auth-success">{info}</p>}
      {error && <p className="auth-error">{error}</p>}
      {!token && (
        <form className="auth-form" onSubmit={(e) => void resend(e)}>
          <div className="auth-field">
            <label htmlFor="auth-verify-email">邮箱（未登录时填写）</label>
            <input
              id="auth-verify-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <TurnstileField onTokenChange={onTokenChange} resetSignal={resetTs} />
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? '发送中…' : '重新发送验证邮件'}
          </button>
        </form>
      )}
      <div className="auth-links">
        <button type="button" onClick={() => onNavigate('app')}>
          返回首页
        </button>
        <button type="button" onClick={() => onNavigate('login')}>
          去登录
        </button>
      </div>
    </div>
  )
}

export default function AuthPages({ page, onNavigate, onAuthed }: AuthPagesProps) {
  const titleMap: Record<AuthPageId, string> = {
    login: '登录',
    register: '注册',
    forgot: '忘记密码',
    reset: '重置密码',
    verify: '邮箱验证',
  }

  return (
    <AuthShell title={titleMap[page]} onBack={() => onNavigate('app')}>
      {page === 'login' && <LoginForm onNavigate={onNavigate} onAuthed={onAuthed} />}
      {page === 'register' && <RegisterForm onNavigate={onNavigate} onAuthed={onAuthed} />}
      {page === 'forgot' && <ForgotForm onNavigate={onNavigate} />}
      {page === 'reset' && <ResetForm onNavigate={onNavigate} onAuthed={onAuthed} />}
      {page === 'verify' && <VerifyPanel onNavigate={onNavigate} onAuthed={onAuthed} />}
    </AuthShell>
  )
}
