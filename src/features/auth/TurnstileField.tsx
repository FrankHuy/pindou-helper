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
    const waitForApi = () => {
      if (window.turnstile) {
        resolve()
        return
      }
      let tries = 0
      const tick = () => {
        if (window.turnstile) {
          resolve()
          return
        }
        tries += 1
        if (tries > 50) {
          reject(new Error('Turnstile 脚本加载失败'))
          return
        }
        window.setTimeout(tick, 50)
      }
      tick()
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (existing) {
      if (window.turnstile) {
        resolve()
        return
      }
      existing.addEventListener('load', waitForApi, { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), {
        once: true,
      })
      // load may already have fired when navigating from XHS tab / another page.
      window.setTimeout(waitForApi, 0)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.dataset.turnstile = '1'
    script.onload = () => waitForApi()
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

/**
 * Explicit Turnstile for auth forms.
 * Host must exist before turnstile.render; we keep the host mounted whenever a
 * site key is known (same pattern as XHS) and retry a few frames if the ref
 * is briefly null. Token callbacks use a ref so parent setState does not
 * re-create the widget.
 */
export default function TurnstileField({ onTokenChange, resetSignal = 0 }: TurnstileFieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | number | null>(null)
  const onTokenChangeRef = useRef(onTokenChange)
  onTokenChangeRef.current = onTokenChange

  const [siteKey, setSiteKey] = useState(BUILD_TURNSTILE_SITE_KEY)
  const [serverRequired, setServerRequired] = useState(false)
  const [configReady, setConfigReady] = useState(false)
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
    // Host DOM is only mounted after configReady && siteKey (see JSX below).
    if (!configReady || !siteKey) return
    let cancelled = false
    let raf = 0

    const emit = (token: string) => {
      onTokenChangeRef.current(token)
    }

    void (async () => {
      try {
        await loadTurnstileScript()
        if (cancelled || !window.turnstile) return

        const tryRender = (attempt: number) => {
          if (cancelled) return
          const host = hostRef.current
          if (!host) {
            if (attempt < 40) {
              raf = window.requestAnimationFrame(() => tryRender(attempt + 1))
            } else if (!cancelled) {
              setLoadError('人机验证区域未就绪，请刷新页面后重试')
            }
            return
          }
          if (widgetIdRef.current != null) return
          host.replaceChildren()
          widgetIdRef.current = window.turnstile!.render(host, {
            sitekey: siteKey,
            theme: 'light',
            callback: (token: string) => emit(token),
            'expired-callback': () => emit(''),
            'error-callback': () => emit(''),
          })
        }

        // Wait a frame so hostRef is attached after this commit.
        raf = window.requestAnimationFrame(() => tryRender(0))
      } catch {
        if (!cancelled) setLoadError('人机验证组件加载失败，请刷新页面后重试')
      }
    })()

    return () => {
      cancelled = true
      if (raf) window.cancelAnimationFrame(raf)
      const id = widgetIdRef.current
      if (id != null && window.turnstile?.remove) {
        try {
          window.turnstile.remove(id)
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = null
      emit('')
    }
  }, [siteKey, configReady])

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
    onTokenChangeRef.current('')
  }, [resetSignal])

  if (!configReady) {
    return <p className="auth-hint">加载人机验证…</p>
  }

  if (serverRequired && !siteKey) {
    return (
      <p className="auth-error-inline">站点人机验证配置不完整，请联系管理员</p>
    )
  }

  if (!siteKey) {
    return <p className="auth-hint">当前环境未启用人机验证</p>
  }

  return (
    <div className="auth-turnstile">
      <div ref={hostRef} className="auth-turnstile-host" />
      {loadError && <p className="auth-error-inline">{loadError}</p>}
    </div>
  )
}
