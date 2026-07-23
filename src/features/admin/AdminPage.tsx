import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { PublicUser } from '../auth/authApi'
import { fetchMe } from '../auth/authApi'
import {
  AdminRequestError,
  banUser,
  fetchAllowlist,
  fetchUsageSummary,
  isAdminRole,
  isSuperAdminRole,
  putAllowlist,
  searchAdminUsers,
  setCircuit,
  setImageQuotaConfig,
  setUserQuota,
  setUserRole,
  unbanUser,
  type AdminUser,
  type UsageSummary,
} from './adminApi'
import './admin.css'

type AdminPageProps = {
  onBack: () => void
  /** Optional shell session; page also loads /api/me for direct /admin visits. */
  sessionUser: PublicUser | null
  onNeedLogin: () => void
}

const ROLE_OPTIONS = [
  { value: 'user', label: '普通' },
  { value: 'vip', label: 'VIP' },
  { value: 'admin', label: '管理员' },
  { value: 'super_admin', label: '超管' },
] as const

function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role
}

export default function AdminPage({ onBack, sessionUser, onNeedLogin }: AdminPageProps) {
  const [actor, setActor] = useState<PublicUser | null>(sessionUser)
  const isSuper = isSuperAdminRole(actor?.role)
  const canAdmin = isAdminRole(actor?.role)

  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [allowlistText, setAllowlistText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(!sessionUser)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({})
  const [imageUserQuota, setImageUserQuota] = useState('6')
  const [imageVipQuota, setImageVipQuota] = useState('20')
  const [imageGlobalCap, setImageGlobalCap] = useState('500')
  const [imageEditEnabled, setImageEditEnabled] = useState(true)

  useEffect(() => {
    setActor(sessionUser)
  }, [sessionUser])

  const handleErr = useCallback(
    (err: unknown) => {
      if (err instanceof AdminRequestError) {
        if (err.status === 401 || err.error === 'auth_required') {
          onNeedLogin()
          return
        }
        setError(err.message)
        return
      }
      setError('请求失败')
    },
    [onNeedLogin],
  )

  const refreshAll = useCallback(
    async (signal?: AbortSignal) => {
      if (!isAdminRole(actor?.role)) {
        setLoading(false)
        return
      }
      setError('')
      try {
        const [userRes, usage] = await Promise.all([
          searchAdminUsers(query, signal),
          fetchUsageSummary(signal),
        ])
        setUsers(userRes.users)
        setSummary(usage)
        setImageUserQuota(String(usage.imageDailyQuotaUser ?? usage.defaultDailyQuota ?? 6))
        setImageVipQuota(String(usage.imageDailyQuotaVip ?? 20))
        setImageGlobalCap(
          String(usage.imageGlobalDailyCap ?? usage.global.limit ?? 500),
        )
        setImageEditEnabled(usage.imageEditEnabled !== false)
        if (isSuperAdminRole(actor?.role)) {
          try {
            const al = await fetchAllowlist(signal)
            setAllowlistText(al.domains.join('\n'))
          } catch (err) {
            if (!(err instanceof AdminRequestError && err.status === 403)) {
              throw err
            }
          }
        }
      } catch (err) {
        handleErr(err)
      } finally {
        setLoading(false)
      }
    },
    [actor?.role, handleErr, query],
  )

  // Resolve session for deep-link /admin (shell bar not mounted).
  useEffect(() => {
    if (sessionUser) {
      setSessionLoading(false)
      return
    }
    const controller = new AbortController()
    setSessionLoading(true)
    void (async () => {
      try {
        const me = await fetchMe(controller.signal)
        if (!controller.signal.aborted) setActor(me?.user ?? null)
      } catch {
        if (!controller.signal.aborted) setActor(null)
      } finally {
        if (!controller.signal.aborted) setSessionLoading(false)
      }
    })()
    return () => controller.abort()
  }, [sessionUser])

  useEffect(() => {
    if (sessionLoading) return
    if (!actor) {
      setLoading(false)
      return
    }
    if (!isAdminRole(actor.role)) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      setError('')
      try {
        const [userRes, usage] = await Promise.all([
          searchAdminUsers('', controller.signal),
          fetchUsageSummary(controller.signal),
        ])
        if (controller.signal.aborted) return
        setUsers(userRes.users)
        setSummary(usage)
        if (isSuperAdminRole(actor.role)) {
          try {
            const al = await fetchAllowlist(controller.signal)
            if (!controller.signal.aborted) setAllowlistText(al.domains.join('\n'))
          } catch (err) {
            if (!(err instanceof AdminRequestError && err.status === 403)) throw err
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) handleErr(err)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [actor, sessionLoading, handleErr])

  const onSearch = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNote('')
    setError('')
    try {
      const res = await searchAdminUsers(query)
      setUsers(res.users)
    } catch (err) {
      handleErr(err)
    } finally {
      setBusy(false)
    }
  }

  const withAction = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      await fn()
    } catch (err) {
      handleErr(err)
    } finally {
      setBusy(false)
    }
  }

  const onBan = (user: AdminUser) =>
    withAction(async () => {
      const reason = window.prompt('封禁原因（可选）', user.banReason ?? '') ?? ''
      const res = await banUser(user.id, reason)
      setNote(res.message)
      setUsers((list) =>
        list.map((u) => (u.id === user.id && res.user ? res.user : u)),
      )
    })

  const onUnban = (user: AdminUser) =>
    withAction(async () => {
      const res = await unbanUser(user.id)
      setNote(res.message)
      setUsers((list) =>
        list.map((u) => (u.id === user.id && res.user ? res.user : u)),
      )
    })

  const onSaveQuota = (user: AdminUser) =>
    withAction(async () => {
      const raw = (quotaDrafts[user.id] ?? '').trim()
      let value: number | null
      if (raw === '') {
        value = null
      } else if (/^\d+$/.test(raw)) {
        value = Number.parseInt(raw, 10)
      } else {
        setError('配额须为非负整数，留空表示清除覆盖')
        return
      }
      const res = await setUserQuota(user.id, value)
      setNote(res.message)
      setUsers((list) =>
        list.map((u) => (u.id === user.id && res.user ? res.user : u)),
      )
    })

  const onRole = (user: AdminUser, role: string) =>
    withAction(async () => {
      const res = await setUserRole(user.id, role)
      setNote(res.message)
      setUsers((list) =>
        list.map((u) => (u.id === user.id && res.user ? res.user : u)),
      )
    })

  const onToggleCircuit = (open: boolean) =>
    withAction(async () => {
      const res = await setCircuit(open)
      setNote(res.message)
      setSummary((prev) => (prev ? { ...prev, circuitOpen: res.open } : prev))
    })

  const onSaveImageQuota = () =>
    withAction(async () => {
      const parse = (raw: string, label: string): number | null => {
        if (!/^\d+$/.test(raw.trim())) {
          setError(`${label} 须为非负整数`)
          return null
        }
        return Number.parseInt(raw.trim(), 10)
      }
      const userQ = parse(imageUserQuota, '普通用户日额度')
      const vipQ = parse(imageVipQuota, 'VIP 日额度')
      const globalQ = parse(imageGlobalCap, '全站日上限')
      if (userQ == null || vipQ == null || globalQ == null) return
      const res = await setImageQuotaConfig({
        imageDailyQuotaUser: userQ,
        imageDailyQuotaVip: vipQ,
        imageGlobalDailyCap: globalQ,
        imageEditEnabled,
      })
      setImageUserQuota(String(res.imageDailyQuotaUser))
      setImageVipQuota(String(res.imageDailyQuotaVip))
      setImageGlobalCap(String(res.imageGlobalDailyCap))
      setImageEditEnabled(res.imageEditEnabled)
      setNote(res.message ?? '出图配额已更新')
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              defaultDailyQuota: res.imageDailyQuotaUser,
              imageDailyQuotaUser: res.imageDailyQuotaUser,
              imageDailyQuotaVip: res.imageDailyQuotaVip,
              imageGlobalDailyCap: res.imageGlobalDailyCap,
              imageEditEnabled: res.imageEditEnabled,
              global: {
                ...prev.global,
                limit: res.imageGlobalDailyCap,
                remaining: Math.max(0, res.imageGlobalDailyCap - prev.global.used),
              },
            }
          : prev,
      )
    })

  const onSaveAllowlist = () =>
    withAction(async () => {
      const domains = allowlistText
        .split(/[\n,]+/)
        .map((d) => d.trim())
        .filter(Boolean)
      const res = await putAllowlist(domains)
      setAllowlistText(res.domains.join('\n'))
      setNote(res.message)
    })

  if (sessionLoading) {
    return (
      <div className="admin-page">
        <header className="admin-topbar">
          <button type="button" className="admin-back" onClick={onBack}>
            ← 返回
          </button>
          <h1>管理</h1>
        </header>
        <div className="admin-body">
          <div className="admin-card">
            <p className="admin-empty">加载会话…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!actor) {
    return (
      <div className="admin-page">
        <header className="admin-topbar">
          <button type="button" className="admin-back" onClick={onBack}>
            ← 返回
          </button>
          <h1>管理</h1>
        </header>
        <div className="admin-body">
          <div className="admin-card">
            <p className="admin-lead">请先登录管理员账号。</p>
            <button type="button" className="admin-btn admin-btn-primary" onClick={onNeedLogin}>
              去登录
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!canAdmin) {
    return (
      <div className="admin-page">
        <header className="admin-topbar">
          <button type="button" className="admin-back" onClick={onBack}>
            ← 返回
          </button>
          <h1>管理</h1>
        </header>
        <div className="admin-body">
          <div className="admin-card">
            <p className="admin-error" role="alert">
              需要管理员权限（API 亦返回 403）
            </p>
            <button type="button" className="admin-btn" onClick={onBack}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <button type="button" className="admin-back" onClick={onBack}>
          ← 返回
        </button>
        <h1>极简管理</h1>
        <span className="admin-role-chip">{roleLabel(actor.role)}</span>
      </header>

      <div className="admin-body">
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        {note && <p className="admin-ok">{note}</p>}

        <section className="admin-card">
          <h2>用量与熔断</h2>
          {loading && !summary ? (
            <p className="admin-empty">加载中…</p>
          ) : summary ? (
            <>
              <div className="admin-stats">
                <div className="admin-stat">
                  <span className="admin-stat-label">UTC 日</span>
                  <span className="admin-stat-value">{summary.day}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">全局 AI</span>
                  <span className="admin-stat-value">
                    {summary.global.used}/{summary.global.limit}
                  </span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">普通用户日额度</span>
                  <span className="admin-stat-value">
                    {summary.imageDailyQuotaUser ?? summary.defaultDailyQuota}
                  </span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">VIP 日额度</span>
                  <span className="admin-stat-value">{summary.imageDailyQuotaVip ?? 20}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">关联上限</span>
                  <span className="admin-stat-value">{summary.associateLimit}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">AI 出图</span>
                  <span className="admin-stat-value">
                    {summary.imageEditEnabled === false ? '关闭' : '开启'}
                  </span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">熔断</span>
                  <span
                    className={`admin-stat-value${summary.circuitOpen ? ' is-danger' : ''}`}
                  >
                    {summary.circuitOpen ? '开启' : '关闭'}
                  </span>
                </div>
              </div>
              <div className="admin-row">
                <button
                  type="button"
                  className="admin-btn admin-btn-danger"
                  disabled={busy || summary.circuitOpen}
                  onClick={() => void onToggleCircuit(true)}
                >
                  开启熔断
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-ok"
                  disabled={busy || !summary.circuitOpen}
                  onClick={() => void onToggleCircuit(false)}
                >
                  关闭熔断
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={busy}
                  onClick={() => void refreshAll()}
                >
                  刷新
                </button>
              </div>
              {summary.topUsers.length > 0 && (
                <div className="admin-table-wrap admin-mt-lg">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>今日用量 TOP</th>
                        <th>角色</th>
                        <th>次数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="admin-user-email">{u.email}</td>
                          <td>{roleLabel(u.role)}</td>
                          <td>{u.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="admin-empty">暂无汇总数据</p>
          )}
        </section>

        <section className="admin-card">
          <h2>AI 出图配额</h2>
          <p className="admin-muted">
            按成功返回的图片张数计费。管理员/超管个人不限；用户覆盖配额仍在用户表设置。
          </p>
          <div className="admin-row">
            <div className="admin-field">
              <label htmlFor="admin-img-user">普通用户日额度</label>
              <input
                id="admin-img-user"
                type="number"
                min={0}
                step={1}
                value={imageUserQuota}
                disabled={busy}
                onChange={(e) => setImageUserQuota(e.target.value)}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="admin-img-vip">VIP 日额度</label>
              <input
                id="admin-img-vip"
                type="number"
                min={0}
                step={1}
                value={imageVipQuota}
                disabled={busy}
                onChange={(e) => setImageVipQuota(e.target.value)}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="admin-img-global">全站日上限</label>
              <input
                id="admin-img-global"
                type="number"
                min={0}
                step={1}
                value={imageGlobalCap}
                disabled={busy}
                onChange={(e) => setImageGlobalCap(e.target.value)}
              />
            </div>
          </div>
          <div className="admin-row admin-mt">
            <label className="admin-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={imageEditEnabled}
                disabled={busy}
                onChange={(e) => setImageEditEnabled(e.target.checked)}
              />
              启用 AI 出图
            </label>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={busy}
              onClick={() => void onSaveImageQuota()}
            >
              保存出图配额
            </button>
          </div>
        </section>

        <section className="admin-card">
          <h2>用户</h2>
          <form className="admin-row" onSubmit={(e) => void onSearch(e)}>
            <div className="admin-field">
              <label htmlFor="admin-user-q">搜索邮箱 / ID</label>
              <input
                id="admin-user-q"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="留空列出最近用户"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
              搜索
            </button>
          </form>

          {users.length === 0 ? (
            <p className="admin-empty">无匹配用户</p>
          ) : (
            <div className="admin-table-wrap admin-mt">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>状态</th>
                    <th>配额覆盖</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const touchBlocked =
                      !isSuper && user.role === 'super_admin'
                    const draft =
                      quotaDrafts[user.id] ??
                      (user.dailyQuotaOverride == null
                        ? ''
                        : String(user.dailyQuotaOverride))
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="admin-user-email">{user.email}</div>
                          <div className="admin-muted">{user.id}</div>
                        </td>
                        <td>
                          <span className={`admin-badge${user.role !== 'user' ? ' is-admin' : ''}`}>
                            {roleLabel(user.role)}
                          </span>
                          {user.banned && (
                            <span className="admin-badge is-banned">已封禁</span>
                          )}
                          {!user.emailVerified && (
                            <span className="admin-badge">未验证</span>
                          )}
                          {user.banReason && (
                            <div className="admin-muted">{user.banReason}</div>
                          )}
                        </td>
                        <td>
                          <div className="admin-actions">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={draft}
                              disabled={busy || touchBlocked}
                              placeholder="默认"
                              onChange={(e) =>
                                setQuotaDrafts((m) => ({
                                  ...m,
                                  [user.id]: e.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="admin-btn"
                              disabled={busy || touchBlocked}
                              onClick={() => void onSaveQuota(user)}
                            >
                              保存
                            </button>
                          </div>
                        </td>
                        <td>
                          <div className="admin-actions">
                            {user.banned ? (
                              <button
                                type="button"
                                className="admin-btn admin-btn-ok"
                                disabled={busy || touchBlocked}
                                onClick={() => void onUnban(user)}
                              >
                                解封
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="admin-btn admin-btn-danger"
                                disabled={
                                  busy || touchBlocked || user.id === actor.id
                                }
                                onClick={() => void onBan(user)}
                              >
                                封禁
                              </button>
                            )}
                            {isSuper && (
                              <select
                                value={user.role}
                                disabled={busy || user.id === actor.id}
                                aria-label="角色"
                                onChange={(e) => void onRole(user, e.target.value)}
                              >
                                {ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {isSuper && (
          <section className="admin-card">
            <h2>邮箱域名白名单（超管）</h2>
            <p className="admin-lead">每行一个域名，精确匹配（不区分大小写）。</p>
            <div className="admin-field">
              <label htmlFor="admin-allowlist">域名列表</label>
              <textarea
                id="admin-allowlist"
                value={allowlistText}
                onChange={(e) => setAllowlistText(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="admin-row admin-mt-sm">
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                disabled={busy}
                onClick={() => void onSaveAllowlist()}
              >
                保存白名单
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
