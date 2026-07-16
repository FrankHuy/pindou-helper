import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import { MARD_PALETTE } from './lib/palette'
import type { BeadPattern } from './lib/pattern'
import { createPattern, drawPattern, exportPattern } from './lib/pattern'

const UploadIcon = () => <span aria-hidden="true">+</span>
const DownloadIcon = () => <span aria-hidden="true">↓</span>

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [targetWidth, setTargetWidth] = useState(48)
  const [pattern, setPattern] = useState<BeadPattern | null>(null)
  const [zoom, setZoom] = useState(14)
  const [showGrid, setShowGrid] = useState(true)
  const [showCodes, setShowCodes] = useState(false)
  const [view, setView] = useState<'pattern' | 'source'>('pattern')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!pattern || !canvasRef.current) return
    drawPattern(canvasRef.current, pattern, {
      cellSize: zoom,
      showGrid,
      showCodes,
    })
  }, [pattern, zoom, showGrid, showCodes])

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  const colorUsage = useMemo(() => {
    if (!pattern) return []
    return MARD_PALETTE
      .filter((bead) => pattern.counts.has(bead.code))
      .map((bead) => ({ ...bead, count: pattern.counts.get(bead.code) ?? 0 }))
      .sort((a, b) => b.count - a.count)
  }, [pattern])

  const generate = async (nextFile = file, width = targetWidth) => {
    if (!nextFile) return
    setBusy(true)
    setError('')
    try {
      const result = await createPattern(nextFile, width, MARD_PALETTE)
      setPattern(result)
      setView('pattern')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图纸生成失败，请换一张图片重试。')
    } finally {
      setBusy(false)
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setFile(nextFile)
    setImageUrl(URL.createObjectURL(nextFile))
    void generate(nextFile)
  }

  const updateWidth = (value: number) => {
    const next = Math.max(8, Math.min(160, value))
    setTargetWidth(next)
    if (file) void generate(file, next)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></div>
        <div>
          <h1>拼豆图纸助手</h1>
          <p>图片仅在当前设备处理</p>
        </div>
        <label className="icon-command upload-command" title="上传图片">
          <UploadIcon />
          <input type="file" accept="image/*" onChange={handleFile} />
        </label>
      </header>

      <section className="workspace">
        <aside className="controls">
          <div className="control-group">
            <span className="control-label">图纸宽度</span>
            <div className="stepper">
              <button onClick={() => updateWidth(targetWidth - 4)} aria-label="减少宽度">−</button>
              <strong>{targetWidth}<small>颗</small></strong>
              <button onClick={() => updateWidth(targetWidth + 4)} aria-label="增加宽度">+</button>
            </div>
            <input
              aria-label="图纸宽度"
              type="range"
              min="8"
              max="160"
              step="4"
              value={targetWidth}
              onChange={(event) => updateWidth(Number(event.target.value))}
            />
          </div>

          <div className="control-group">
            <span className="control-label">显示</span>
            <label className="toggle-row">
              <span>网格</span>
              <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
            </label>
            <label className="toggle-row">
              <span>色号</span>
              <input type="checkbox" checked={showCodes} onChange={(event) => setShowCodes(event.target.checked)} />
            </label>
          </div>

          <div className="control-group">
            <span className="control-label">缩放</span>
            <input
              aria-label="预览缩放"
              type="range"
              min="6"
              max="32"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </div>

          {pattern && (
            <button className="download-button" onClick={() => exportPattern(pattern, showCodes)}>
              <DownloadIcon /> 导出 PNG
            </button>
          )}
        </aside>

        <section className="stage-panel">
          <div className="stage-toolbar">
            <div className="segmented" aria-label="预览模式">
              <button className={view === 'pattern' ? 'active' : ''} onClick={() => setView('pattern')}>图纸</button>
              <button className={view === 'source' ? 'active' : ''} onClick={() => setView('source')} disabled={!imageUrl}>原图</button>
            </div>
            {pattern && <span className="dimensions">{pattern.width} × {pattern.height} · {pattern.cells.length} 颗</span>}
          </div>

          <div className="stage">
            {!file && (
              <label className="empty-state">
                <span className="empty-icon"><UploadIcon /></span>
                <strong>选择一张图片</strong>
                <span>支持照片、插画和像素图</span>
                <input type="file" accept="image/*" onChange={handleFile} />
              </label>
            )}
            {busy && <div className="loading">正在生成图纸…</div>}
            {error && <div className="error-message">{error}</div>}
            {file && view === 'pattern' && <canvas ref={canvasRef} />}
            {file && view === 'source' && <img className="source-image" src={imageUrl} alt="上传的原图" />}
          </div>
        </section>

        <aside className="palette-panel">
          <div className="palette-heading">
            <div><span>MARD 基础色</span><strong>{colorUsage.length} 种</strong></div>
            <span className="palette-note">MVP 色卡</span>
          </div>
          {colorUsage.length === 0 ? (
            <p className="palette-empty">生成图纸后显示颜色用量</p>
          ) : (
            <div className="color-list">
              {colorUsage.map((bead) => (
                <div className="color-row" key={bead.code}>
                  <span className="swatch" style={{ backgroundColor: bead.hex }} />
                  <span className="color-code">{bead.code}</span>
                  <span className="color-name">{bead.name}</span>
                  <strong>{bead.count}</strong>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
    </main>
  )
}

export default App
