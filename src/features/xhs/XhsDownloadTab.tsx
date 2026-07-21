import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { XhsParseResult } from './xhsApi'
import {
  activeImagePath,
  extractFirstUrl,
  fetchPublicConfig,
  parseXhsNote,
  saveImage,
} from './xhsApi'
import './xhs.css'

type Phase = 'idle' | 'loading' | 'success' | 'error'

/** Optional build-time fallback; runtime /api/config is preferred for CF Git deploys. */
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
      // Script tag exists; if turnstile already present resolve immediately.
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

export default function XhsDownloadTab() {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<XhsParseResult | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveHint, setSaveHint] = useState('')
  /** Prefer CDN JPG (proxyPathJpg) for preview/save; default off = bare original. */
  const [preferJpg, setPreferJpg] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(BUILD_TURNSTILE_SITE_KEY)
  const [turnstileServerRequired, setTurnstileServerRequired] = useState(false)
  const [configReady, setConfigReady] = useState(!BUILD_TURNSTILE_SITE_KEY)
  const parseAbortRef = useRef<AbortController | null>(null)
  const parseGenRef = useRef(0)
  const turnstileHostRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetIdRef = useRef<string | number | null>(null)
  const turnstileTokenRef = useRef('')

  const loading = phase === 'loading'
  const images = result?.images ?? []
  const activeImage =
    lightboxIndex != null && images[lightboxIndex] ? images[lightboxIndex] : null
  const activePath = activeImage ? activeImagePath(activeImage, preferJpg) : null
  // Show widget whenever we have a site key (runtime or build-time).
  const turnstileRequired = Boolean(turnstileSiteKey)
  // If Worker enforces secret but site key is missing, surface a setup error.
  const turnstileMisconfigured = turnstileServerRequired && !turnstileSiteKey && configReady

  const resetTurnstile = useCallback(() => {
    turnstileTokenRef.current = ''
    setTurnstileToken('')
    const id = turnstileWidgetIdRef.current
    if (id != null && window.turnstile) {
      try {
        window.turnstile.reset(id)
      } catch {
        // ignore reset races
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      parseAbortRef.current?.abort()
    }
  }, [])

  // Load site key from Worker runtime so CF Git deploys work without Vite bake-in.
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const config = await fetchPublicConfig(controller.signal)
        if (config.turnstileSiteKey) {
          setTurnstileSiteKey(config.turnstileSiteKey)
        } else if (BUILD_TURNSTILE_SITE_KEY) {
          setTurnstileSiteKey(BUILD_TURNSTILE_SITE_KEY)
        }
        setTurnstileServerRequired(config.turnstileRequired)
      } catch {
        // Keep build-time key if any; parse may still work when secret unset.
        if (BUILD_TURNSTILE_SITE_KEY) setTurnstileSiteKey(BUILD_TURNSTILE_SITE_KEY)
      } finally {
        setConfigReady(true)
      }
    })()
    return () => controller.abort()
  }, [])

  // Render Turnstile only after site key is known and host node is mounted.
  useEffect(() => {
    if (!turnstileSiteKey) return
    let cancelled = false

    void (async () => {
      try {
        await loadTurnstileScript()
        if (cancelled || !window.turnstile) return

        // Host is rendered only when turnstileSiteKey is set; wait a frame for ref.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        if (cancelled || !turnstileHostRef.current) return
        if (turnstileWidgetIdRef.current != null) return

        turnstileWidgetIdRef.current = window.turnstile.render(turnstileHostRef.current, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          callback: (token: string) => {
            turnstileTokenRef.current = token
            setTurnstileToken(token)
          },
          'expired-callback': () => {
            turnstileTokenRef.current = ''
            setTurnstileToken('')
          },
          'error-callback': () => {
            turnstileTokenRef.current = ''
            setTurnstileToken('')
          },
        })
      } catch {
        if (!cancelled) {
          setError('人机验证组件加载失败，请刷新页面后重试')
        }
      }
    })()

    return () => {
      cancelled = true
      const id = turnstileWidgetIdRef.current
      if (id != null && window.turnstile?.remove) {
        try {
          window.turnstile.remove(id)
        } catch {
          // ignore
        }
      }
      turnstileWidgetIdRef.current = null
      turnstileTokenRef.current = ''
      setTurnstileToken('')
    }
  }, [turnstileSiteKey])

  const runParse = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text) {
        setPhase('error')
        setError('请粘贴小红书分享链接')
        setResult(null)
        return
      }

      if (turnstileMisconfigured) {
        setPhase('error')
        setError(
          '人机验证未正确配置：服务端已开启校验，但缺少公开 Site Key。请在 Worker 运行时变量中设置 TURNSTILE_SITE_KEY（或 VITE_TURNSTILE_SITE_KEY）。',
        )
        setResult(null)
        return
      }

      if (turnstileRequired && !turnstileTokenRef.current) {
        setPhase('error')
        setError('请先完成人机验证')
        setResult(null)
        return
      }

      parseAbortRef.current?.abort()
      const controller = new AbortController()
      parseAbortRef.current = controller
      const gen = ++parseGenRef.current
      const tokenSnapshot = turnstileTokenRef.current

      setPhase('loading')
      setError('')
      setResult(null)
      setLightboxIndex(null)
      setSaveHint('')

      try {
        const data = await parseXhsNote(text, controller.signal, tokenSnapshot || undefined)
        if (gen !== parseGenRef.current) return
        setResult(data)
        setPhase('success')
      } catch (reason) {
        if (gen !== parseGenRef.current) return
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (reason instanceof Error && reason.name === 'AbortError') return
        setPhase('error')
        setResult(null)
        setError(reason instanceof Error ? reason.message : '解析失败，请稍后重试')
      } finally {
        if (gen === parseGenRef.current) {
          resetTurnstile()
        }
      }
    },
    [resetTurnstile, turnstileMisconfigured, turnstileRequired],
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    void runParse(input)
  }

  const handlePasteNormalize = () => {
    window.setTimeout(() => {
      setInput((current) => {
        const url = extractFirstUrl(current)
        return url && url !== current.trim() ? url : current
      })
    }, 0)
  }

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setSaveHint('')
  }

  const closeLightbox = () => {
    setLightboxIndex(null)
    setSaving(false)
    setSaveHint('')
  }

  const goPrev = () => {
    if (lightboxIndex == null || images.length === 0) return
    setLightboxIndex((lightboxIndex - 1 + images.length) % images.length)
    setSaveHint('')
  }

  const goNext = () => {
    if (lightboxIndex == null || images.length === 0) return
    setLightboxIndex((lightboxIndex + 1) % images.length)
    setSaveHint('')
  }

  const handleSave = async () => {
    if (!activeImage || saving) return
    setSaving(true)
    setSaveHint('')
    try {
      await saveImage(activeImagePath(activeImage, preferJpg), activeImage.index)
      setSaveHint('已触发保存；若未弹出，可长按图片用系统菜单保存')
    } catch (reason) {
      setSaveHint(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (lightboxIndex == null) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxIndex(null)
        setSaving(false)
        setSaveHint('')
        return
      }
      if (event.key === 'ArrowLeft') {
        setLightboxIndex((current) => {
          if (current == null || images.length === 0) return current
          return (current - 1 + images.length) % images.length
        })
        setSaveHint('')
        return
      }
      if (event.key === 'ArrowRight') {
        setLightboxIndex((current) => {
          if (current == null || images.length === 0) return current
          return (current + 1) % images.length
        })
        setSaveHint('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [lightboxIndex, images.length])

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!loading) void runParse(input)
    }
  }

  const parseDisabled =
    loading ||
    turnstileMisconfigured ||
    (turnstileRequired && !turnstileToken) ||
    (!configReady && turnstileServerRequired)

  return (
    <div className="xhs-tab">
      <section className="xhs-panel">
        <div className="xhs-intro">
          <h2>小红书高清图下载</h2>
          <p>粘贴公开图文分享链接，预览后逐张保存到本机。不支持私密帖与登录绕过。</p>
        </div>

        <form className="xhs-form" onSubmit={handleSubmit}>
          <label className="xhs-label" htmlFor="xhs-url-input">
            分享链接
          </label>
          <textarea
            id="xhs-url-input"
            className="xhs-input"
            rows={3}
            placeholder="粘贴 https://www.xiaohongshu.com/… 或 xhslink.com 短链 / 分享文案"
            value={input}
            disabled={loading}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePasteNormalize}
            onKeyDown={onInputKeyDown}
          />

          {turnstileMisconfigured && (
            <div className="xhs-status xhs-status-error" role="alert">
              <p>
                服务端已开启人机校验，但未提供 Site Key，因此无法显示验证框。请在 Cloudflare Worker
                <strong>运行时</strong>变量中增加{' '}
                <code>TURNSTILE_SITE_KEY</code>（Site Key，公开）并重新部署。
              </p>
            </div>
          )}

          {turnstileRequired && (
            <div className="xhs-turnstile-wrap">
              <span className="xhs-label">人机验证</span>
              <div ref={turnstileHostRef} className="xhs-turnstile" />
            </div>
          )}

          <div className="xhs-actions">
            <button type="submit" className="xhs-primary" disabled={parseDisabled}>
              {loading ? '解析中…' : '解析图片'}
            </button>
            {input && !loading && (
              <button
                type="button"
                className="xhs-secondary"
                onClick={() => {
                  setInput('')
                  setError('')
                  setResult(null)
                  setPhase('idle')
                }}
              >
                清空
              </button>
            )}
          </div>
          <p className="xhs-compliance">
            仅用于公开帖且你有权保存的素材；图片经本站 Worker 同源代理获取，不会保存你的登录态或 Cookie。
          </p>
        </form>

        {loading && (
          <div className="xhs-status xhs-status-loading" role="status">
            正在解析分享页…
          </div>
        )}

        {phase === 'error' && error && (
          <div className="xhs-status xhs-status-error" role="alert">
            <p>{error}</p>
            <button type="button" className="xhs-secondary" onClick={() => void runParse(input)}>
              重试
            </button>
          </div>
        )}

        {phase === 'success' && result && (
          <div className="xhs-result">
            <div className="xhs-result-head">
              <div className="xhs-result-title-block">
                <h3>{result.title}</h3>
                <span>共 {result.images.length} 张 · 点击缩略图放大后保存</span>
              </div>
              <label className="xhs-jpg-toggle">
                <input
                  type="checkbox"
                  checked={preferJpg}
                  onChange={(event) => setPreferJpg(event.target.checked)}
                />
                <span>兼容 JPG（便于预览/部分设备保存）</span>
              </label>
            </div>
            <div className="xhs-grid" role="list">
              {result.images.map((image, index) => {
                const path = activeImagePath(image, preferJpg)
                return (
                  <button
                    key={`${image.index}-${path}`}
                    type="button"
                    className="xhs-thumb"
                    role="listitem"
                    onClick={() => openLightbox(index)}
                    aria-label={`查看第 ${image.index} 张`}
                  >
                    <img src={path} alt={`第 ${image.index} 张`} loading="lazy" />
                    <span className="xhs-thumb-index">{image.index}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {activeImage && lightboxIndex != null && (
        <div
          className="xhs-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={closeLightbox}
        >
          <div className="xhs-lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <div className="xhs-lightbox-toolbar">
              <span>
                {activeImage.index} / {images.length}
              </span>
              <button type="button" className="xhs-secondary" onClick={closeLightbox}>
                关闭
              </button>
            </div>

            <div className="xhs-lightbox-stage">
              {images.length > 1 && (
                <button
                  type="button"
                  className="xhs-nav xhs-nav-prev"
                  onClick={goPrev}
                  aria-label="上一张"
                >
                  ‹
                </button>
              )}
              {activePath && (
                <img
                  className="xhs-lightbox-image"
                  src={activePath}
                  alt={`第 ${activeImage.index} 张高清图`}
                />
              )}
              {images.length > 1 && (
                <button
                  type="button"
                  className="xhs-nav xhs-nav-next"
                  onClick={goNext}
                  aria-label="下一张"
                >
                  ›
                </button>
              )}
            </div>

            <div className="xhs-lightbox-actions">
              <button
                type="button"
                className="xhs-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? '保存中…' : '保存图片'}
              </button>
              <p className="xhs-save-hint">也可长按图片，用系统菜单保存。两种方式均可。</p>
              {saveHint && <p className="xhs-save-feedback">{saveHint}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
