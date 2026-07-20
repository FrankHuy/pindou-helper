import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { XhsParseResult } from './xhsApi'
import { extractFirstUrl, parseXhsNote, saveImage } from './xhsApi'
import './xhs.css'

type Phase = 'idle' | 'loading' | 'success' | 'error'

export default function XhsDownloadTab() {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<XhsParseResult | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveHint, setSaveHint] = useState('')
  const parseAbortRef = useRef<AbortController | null>(null)
  const parseGenRef = useRef(0)

  const loading = phase === 'loading'
  const images = result?.images ?? []
  const activeImage =
    lightboxIndex != null && images[lightboxIndex] ? images[lightboxIndex] : null

  useEffect(() => {
    return () => {
      parseAbortRef.current?.abort()
    }
  }, [])

  const runParse = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text) {
      setPhase('error')
      setError('请粘贴小红书分享链接')
      setResult(null)
      return
    }

    parseAbortRef.current?.abort()
    const controller = new AbortController()
    parseAbortRef.current = controller
    const gen = ++parseGenRef.current

    setPhase('loading')
    setError('')
    setResult(null)
    setLightboxIndex(null)
    setSaveHint('')

    try {
      const data = await parseXhsNote(text, controller.signal)
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
    }
  }, [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    void runParse(input)
  }

  const handlePasteNormalize = () => {
    // After paste settles, try to surface the first URL in the field.
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
      await saveImage(activeImage.proxyPath, activeImage.index)
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
          <div className="xhs-actions">
            <button type="submit" className="xhs-primary" disabled={loading}>
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
              <h3>{result.title}</h3>
              <span>
                共 {result.images.length} 张 · 点击缩略图放大后保存
              </span>
            </div>
            <div className="xhs-grid" role="list">
              {result.images.map((image, index) => (
                <button
                  key={`${image.index}-${image.proxyPath}`}
                  type="button"
                  className="xhs-thumb"
                  role="listitem"
                  onClick={() => openLightbox(index)}
                  aria-label={`查看第 ${image.index} 张`}
                >
                  <img src={image.proxyPath} alt={`第 ${image.index} 张`} loading="lazy" />
                  <span className="xhs-thumb-index">{image.index}</span>
                </button>
              ))}
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
          <div
            className="xhs-lightbox-inner"
            onClick={(event) => event.stopPropagation()}
          >
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
              <img
                className="xhs-lightbox-image"
                src={activeImage.proxyPath}
                alt={`第 ${activeImage.index} 张高清图`}
              />
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
              <p className="xhs-save-hint">
                也可长按图片，用系统菜单保存。两种方式均可。
              </p>
              {saveHint && <p className="xhs-save-feedback">{saveHint}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
