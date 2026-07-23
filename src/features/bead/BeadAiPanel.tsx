/**
 * Optional AI 优化 pre-step for bead tab.
 * Default path remains local; this only runs after explicit user submit.
 * After generation, original + all candidates stay available for switching.
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

type Candidate = BeadAiImage & { objectUrl: string; file?: File }

type ActiveKey = 'original' | number

export default function BeadAiPanel({
  file,
  sessionUser,
  onLogin,
  onApplyFile,
}: BeadAiPanelProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState('chibi')
  const [n, setN] = useState(1)
  /** Session-only; never written to localStorage / user profile. */
  const [userApiKey, setUserApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quotaHint, setQuotaHint] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [original, setOriginal] = useState<{ file: File; objectUrl: string } | null>(null)
  const [activeKey, setActiveKey] = useState<ActiveKey>('original')
  const inflightRef = useRef(false)
  /** When true, next `file` prop change is from our own apply — do not wipe gallery. */
  const skipFileResetRef = useRef(false)
  const objectUrlsRef = useRef<string[]>([])
  const originalUrlRef = useRef<string | null>(null)

  const revokeCandidateUrls = () => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current = []
  }

  const revokeOriginalUrl = () => {
    if (originalUrlRef.current) {
      URL.revokeObjectURL(originalUrlRef.current)
      originalUrlRef.current = null
    }
  }

  useEffect(
    () => () => {
      revokeCandidateUrls()
      revokeOriginalUrl()
    },
    [],
  )

  // External source change (user upload): reset AI session and adopt as original.
  // Apply-from-gallery sets skipFileResetRef so candidates stay.
  useEffect(() => {
    if (skipFileResetRef.current) {
      skipFileResetRef.current = false
      return
    }

    setOpen(false)
    setError('')
    setBusy(false)
    inflightRef.current = false
    revokeCandidateUrls()
    setCandidates([])
    revokeOriginalUrl()

    if (file) {
      const objectUrl = URL.createObjectURL(file)
      originalUrlRef.current = objectUrl
      setOriginal({ file, objectUrl })
      setActiveKey('original')
    } else {
      setOriginal(null)
      setActiveKey('original')
    }
  }, [file])

  if (!file && !original) return null

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

  const applySource = (nextFile: File, key: ActiveKey) => {
    skipFileResetRef.current = true
    setActiveKey(key)
    onApplyFile(nextFile)
  }

  const selectOriginal = () => {
    if (!original || busy) return
    applySource(original.file, 'original')
  }

  const selectCandidate = async (index: number) => {
    const pick = candidates.find((c) => c.index === index)
    if (!pick || busy) return
    setBusy(true)
    setError('')
    try {
      let nextFile = pick.file
      if (!nextFile) {
        nextFile = await beadAiImageToFile(pick, `ai-candidate-${pick.index}.png`)
        setCandidates((list) =>
          list.map((c) => (c.index === pick.index ? { ...c, file: nextFile } : c)),
        )
      }
      applySource(nextFile, pick.index)
    } catch {
      setError('切换图片失败')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    const sourceFile = original?.file ?? file
    if (!sourceFile || inflightRef.current || busy) return
    if (!sessionUser) {
      onLogin()
      return
    }

    inflightRef.current = true
    setBusy(true)
    setError('')
    // New generation replaces previous candidates only (original kept).
    revokeCandidateUrls()
    setCandidates([])

    try {
      // Always edit from original upload when available, not from last AI pick.
      const result = await requestBeadAiImageEdit({
        file: sourceFile,
        style: style.trim() || 'chibi',
        n,
        apiKey: userApiKey.trim() || undefined,
      })
      const next: Candidate[] = result.images.map((img) => {
        const objectUrl = beadAiImageToObjectUrl(img)
        objectUrlsRef.current.push(objectUrl)
        return { ...img, objectUrl }
      })
      setCandidates(next)
      setOpen(true)
      if (result.usedUserApiKey) {
        setQuotaHint('已使用你填写的 API Key · 未扣平台额度')
      } else if (result.remaining.userLimit < 0) {
        setQuotaHint('今日额度：个人不限')
      } else {
        setQuotaHint(
          `本次扣 ${result.charged} 张 · 剩余 ${result.remaining.user}/${result.remaining.userLimit}`,
        )
      }
      // Auto-select first candidate into pipeline but keep gallery.
      if (next[0]) {
        const firstFile = await beadAiImageToFile(next[0], `ai-candidate-${next[0].index}.png`)
        setCandidates((list) =>
          list.map((c) => (c.index === next[0].index ? { ...c, file: firstFile } : c)),
        )
        applySource(firstFile, next[0].index)
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

  const hasGallery = Boolean(original && (candidates.length > 0 || activeKey !== 'original'))

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
          <p className="bead-ai-panel-title">生成候选图后可随时切换对比</p>
          <p className="bead-ai-privacy">
            图片将上传至服务器并转发至第三方图像服务；按成功返回的张数扣减当日额度。再次提交会替换候选图，原图会保留。
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
          <div className="bead-ai-field">
            <label htmlFor="bead-ai-user-key">我的 API Key（可选，临时）</label>
            <input
              id="bead-ai-user-key"
              type="password"
              autoComplete="off"
              value={userApiKey}
              disabled={busy}
              placeholder="留空则使用平台额度"
              onChange={(e) => setUserApiKey(e.target.value)}
              spellCheck={false}
            />
            <p className="bead-ai-key-hint">
              填写后走你自己的上游额度，不扣本站张数；仅本次会话保存在页面，不会写入账号配置。
            </p>
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
                // Keep candidates + original for switching even when form collapsed.
              }}
            >
              收起面板
            </button>
          </div>
          {error && (
            <p className="bead-ai-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {/* Persistent gallery: original + AI results; click to drive bead pipeline */}
      {original && candidates.length > 0 && (
        <div className="bead-ai-gallery" role="listbox" aria-label="原图与 AI 候选，点击切换">
          <p className="bead-ai-gallery-title">源图切换（原图与候选均保留）</p>
          <div className="bead-ai-results">
            <button
              type="button"
              role="option"
              aria-selected={activeKey === 'original'}
              className={`bead-ai-card${activeKey === 'original' ? ' selected' : ''}`}
              onClick={selectOriginal}
              disabled={busy}
            >
              <img src={original.objectUrl} alt="上传原图" />
              <span>原图</span>
            </button>
            {candidates.map((c) => (
              <button
                key={c.index}
                type="button"
                role="option"
                aria-selected={activeKey === c.index}
                className={`bead-ai-card${activeKey === c.index ? ' selected' : ''}`}
                onClick={() => void selectCandidate(c.index)}
                disabled={busy}
              >
                <img src={c.objectUrl} alt={`候选 ${c.index}`} />
                <span>候选 {c.index}</span>
              </button>
            ))}
          </div>
          <p className="bead-ai-gallery-hint">
            点击缩略图切换当前用于拼豆的源图，可反复对比；不会丢掉其它图。
          </p>
        </div>
      )}

      {!open && hasGallery && candidates.length === 0 ? null : null}
      {!open && candidates.length > 0 && (
        <button type="button" className="bead-ai-reopen" onClick={openPanel}>
          继续 AI 设置
        </button>
      )}
    </div>
  )
}
