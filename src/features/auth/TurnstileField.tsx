import { useEffect, useRef, useState } from 'react'
import { fetchPublicConfig } from '../xhs/xhsApi'

const BUILD_TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? ''

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      theme?: 'light' | 'dark' | 'auto'
    },
  ) => string | number
  reset: (widgetId?: string | number) => void
  remove?: (widgetId?: string | number) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), {
        once: true,
      })
      if (window.turnstile) resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.dataset.turnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败'))
    document.head.appendChild(script)
  })
  return turnstileScriptPromise
}

type TurnstileFieldProps = {
  onTokenChange: (token: string) => void
  /** Bump to force widget reset after submit. */
  resetSignal?: number
}

export default function TurnstileField({ onTokenChange, resetSignal = 0 }: TurnstileFieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | number | null>(null)
  const [siteKey, setSiteKey] = useState(BUILD_TURNSTILE_SITE_KEY)
  const [serverRequired, setServerRequired] = useState(false)
  const [configReady, setConfigReady] = useState(!BUILD_TURNSTILE_SITE_KEY)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const config = await fetchPublicConfig(controller.signal)
        if (config.turnstileSiteKey) setSiteKey(config.turnstileSiteKey)
        else if (BUILD_TURNSTILE_SITE_KEY) setSiteKey(BUILD_TURNSTILE_SITE_KEY)
        setServerRequired(config.turnstileRequired)
      } catch {
        if (BUILD_TURNSTILE_SITE_KEY) setSiteKey(BUILD_TURNSTILE_SITE_KEY)
      } finally {
        setConfigReady(true)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    void (async () => {
      try {
        await loadTurnstileScript()
        if (cancelled || !window.turnstile) return
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (cancelled || !hostRef.current) return
        if (widgetIdRef.current != null) return

        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token: string) => onTokenChange(token),
          'expired-callback': () => onTokenChange(''),
          'error-callback': () => onTokenChange(''),
        })
      } catch {
        if (!cancelled) setLoadError('人机验证组件加载失败，请刷新页面后重试')
      }
    })()

    return () => {
      cancelled = true
      const id = widgetIdRef.current
      if (id != null && window.turnstile?.remove) {
        try {
          window.turnstile.remove(id)
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = null
      onTokenChange('')
    }
  }, [siteKey, onTokenChange])

  useEffect(() => {
    if (resetSignal <= 0) return
    const id = widgetIdRef.current
    if (id != null && window.turnstile) {
      try {
        window.turnstile.reset(id)
      } catch {
        // ignore
      }
    }
    onTokenChange('')
  }, [resetSignal, onTokenChange])

  if (!configReady) {
    return <p className="auth-hint">加载人机验证…</p>
  }

  if (serverRequired && !siteKey) {
    return (
      <p className="auth-error-inline">站点人机验证配置不完整，请联系管理员</p>
    )
  }

  if (!siteKey) {
    // Dev without Turnstile secret/site key — server will skip verification.
    return <p className="auth-hint">当前环境未启用人机验证</p>
  }

  return (
    <div className="auth-turnstile">
      <div ref={hostRef} />
      {loadError && <p className="auth-error-inline">{loadError}</p>}
    </div>
  )
}
