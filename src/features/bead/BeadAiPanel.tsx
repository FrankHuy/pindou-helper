/**
 * Optional AI 优化 pre-step for bead tab.
 * Default path remains local; this only runs after explicit user submit.
 */

import { useEffect, useRef, useState } from 'react'
import type { PublicUser } from '../auth/authApi'
import { AuthRequestError, fetchMe } from '../auth/authApi'
import {
  beadAiImageToFile,
  beadAiImageToObjectUrl,
  requestBeadAiImageEdit,
  type BeadAiImage,
} from './beadAiApi'
import './bead-ai.css'

type BeadAiPanelProps = {
  file: File | null
  sessionUser: PublicUser | null
  onLogin: () => void
  /** Replace bead source image and re-run local pipeline. */
  onApplyFile: (file: File) => void
}

type Candidate = BeadAiImage & { objectUrl: string }

export default function BeadAiPanel({
  file,
  sessionUser,
  onLogin,
  onApplyFile,
}: BeadAiPanelProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState('chibi')
  const [n, setN] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quotaHint, setQuotaHint] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const inflightRef = useRef(false)
  const objectUrlsRef = useRef<string[]>([])

  const revokeCandidates = () => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current = []
    setCandidates([])
    setSelected(null)
  }

  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    },
    [],
  )

  // Reset panel when source file changes from outside.
  useEffect(() => {
    setOpen(false)
    setError('')
    setBusy(false)
    inflightRef.current = false
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current = []
    setCandidates([])
    setSelected(null)
  }, [file])

  if (!file) return null

  const refreshQuotaHint = async () => {
    try {
      const me = await fetchMe()
      if (!me) {
        setQuotaHint(null)
        return
      }
      if (me.quota.circuitOpen) {
        setQuotaHint('全局熔断中，暂不可用')
        return
      }
      const limit = me.quota.dailyLimit
      const remaining = me.quota.dailyRemaining
      if (limit < 0 || remaining < 0) {
        setQuotaHint('今日额度：个人不限')
      } else {
        setQuotaHint(`今日剩余 ${remaining}/${limit} 张`)
      }
    } catch {
      setQuotaHint(null)
    }
  }

  const openPanel = () => {
    if (!sessionUser) {
      onLogin()
      return
    }
    setOpen(true)
    setError('')
    void refreshQuotaHint()
  }

  const submit = async () => {
    if (!file || inflightRef.current || busy) return
    if (!sessionUser) {
      onLogin()
      return
    }

    inflightRef.current = true
    setBusy(true)
    setError('')
    revokeCandidates()

    try {
      const result = await requestBeadAiImageEdit({
        file,
        style: style.trim() || 'chibi',
        n,
      })
      const next: Candidate[] = result.images.map((img) => {
        const objectUrl = beadAiImageToObjectUrl(img)
        objectUrlsRef.current.push(objectUrl)
        return { ...img, objectUrl }
      })
      setCandidates(next)
      setSelected(next[0]?.index ?? null)
      if (result.remaining.userLimit < 0) {
        setQuotaHint('今日额度：个人不限')
      } else {
        setQuotaHint(
          `本次扣 ${result.charged} 张 · 剩余 ${result.remaining.user}/${result.remaining.userLimit}`,
        )
      }
    } catch (err) {
      if (err instanceof AuthRequestError) {
        if (err.error === 'auth_required') {
          setError('请先登录')
          onLogin()
        } else {
          setError(err.message)
        }
      } else {
        setError('AI 优化失败，请稍后再试')
      }
    } finally {
      inflightRef.current = false
      setBusy(false)
    }
  }

  const applySelected = async () => {
    const pick = candidates.find((c) => c.index === selected)
    if (!pick || busy) return
    setBusy(true)
    setError('')
    try {
      const nextFile = await beadAiImageToFile(pick, 'ai-optimized.png')
      onApplyFile(nextFile)
      setOpen(false)
      revokeCandidates()
    } catch {
      setError('应用图片失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="control-group bead-ai-block">
      <span className="control-label">AI 优化（可选）</span>
      {!open ? (
        <>
          <button
            type="button"
            className="bead-ai-trigger pulse"
            onClick={openPanel}
          >
            AI 优化
          </button>
          <p className="bead-ai-privacy">
            默认仍用本地原图生成。使用 AI 时，图片将上传至服务器并转发至第三方图像服务。
          </p>
        </>
      ) : (
        <div className="bead-ai-panel">
          <p className="bead-ai-panel-title">生成候选图后选用一张</p>
          <p className="bead-ai-privacy">
            图片将上传至服务器并转发至第三方图像服务；按成功返回的张数扣减当日额度。
          </p>
          <div className="bead-ai-field">
            <label htmlFor="bead-ai-style">画风（最多 10 字，默认 chibi）</label>
            <input
              id="bead-ai-style"
              type="text"
              maxLength={10}
              value={style}
              disabled={busy}
              placeholder="chibi"
              onChange={(e) => setStyle(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="bead-ai-field">
            <label htmlFor="bead-ai-n">张数</label>
            <select
              id="bead-ai-n"
              value={n}
              disabled={busy}
              onChange={(e) => setN(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {quotaHint && <p className="bead-ai-quota">{quotaHint}</p>}
          <div className="bead-ai-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy && candidates.length === 0 ? '生成中…' : '提交生成'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setError('')
                revokeCandidates()
              }}
            >
              关闭
            </button>
            {candidates.length > 0 && (
              <button
                type="button"
                className="primary"
                disabled={busy || selected == null}
                onClick={() => void applySelected()}
              >
                使用此图
              </button>
            )}
          </div>
          {error && (
            <p className="bead-ai-error" role="alert">
              {error}
            </p>
          )}
          {candidates.length > 0 && (
            <div className="bead-ai-results" role="listbox" aria-label="AI 候选图">
              {candidates.map((c) => (
                <button
                  key={c.index}
                  type="button"
                  role="option"
                  aria-selected={selected === c.index}
                  className={`bead-ai-card${selected === c.index ? ' selected' : ''}`}
                  onClick={() => setSelected(c.index)}
                  disabled={busy}
                >
                  <img src={c.objectUrl} alt={`候选 ${c.index}`} />
                  <span>候选 {c.index}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
