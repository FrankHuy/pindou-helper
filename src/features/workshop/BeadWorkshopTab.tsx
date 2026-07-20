import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import { MARD_COLORS } from '../../lib/palettes'
import {
  analyzeWorkshopImageData,
  clampSplitY,
  drawPixelPreview,
  estimateSplitY,
  fileToImageData,
  type WorkshopAnalyzeOutput,
} from '../../lib/workshop/analyze'
import { drawPattern, HIGHLIGHT_DIM_ALPHA } from '../../lib/pattern'
import './workshop.css'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/*'

export default function BeadWorkshopTab() {
  const [fileName, setFileName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const [splitRatio, setSplitRatio] = useState(0.78)
  const [result, setResult] = useState<WorkshopAnalyzeOutput | null>(null)
  const [highlightCode, setHighlightCode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(14)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceWrapRef = useRef<HTMLDivElement>(null)
  const sourceImgRef = useRef<HTMLImageElement>(null)
  const analyzeGenRef = useRef(0)
  const splitRatioRef = useRef(splitRatio)
  splitRatioRef.current = splitRatio

  const fullPalette = useMemo(() => MARD_COLORS, [])

  // Object URL lifecycle
  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    }
  }, [sourceUrl])

  const runAnalyze = useCallback(
    async (image: ImageData, ratio: number) => {
      const gen = ++analyzeGenRef.current
      setBusy(true)
      setError('')
      try {
        const splitY = clampSplitY(ratio * image.height, image.height)
        const output = analyzeWorkshopImageData(image, {
          fullPalette,
          splitY,
        })
        if (gen !== analyzeGenRef.current) return
        setResult(output)
        setSplitRatio(output.splitY / image.height)
        setHighlightCode(null)
      } catch (err) {
        if (gen !== analyzeGenRef.current) return
        setResult(null)
        setError(err instanceof Error ? err.message : '识别失败，请调整分隔线后重试')
      } finally {
        if (gen === analyzeGenRef.current) setBusy(false)
      }
    },
    [fullPalette],
  )

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    setFileName(file.name)
    setResult(null)
    setHighlightCode(null)
    setError('')
    setBusy(true)

    const gen = ++analyzeGenRef.current
    try {
      // Decode first so a failed analyze still keeps the image for split retry (AC4 / R8).
      const image = await fileToImageData(file)
      if (gen !== analyzeGenRef.current) return

      setImageData(image)
      const autoSplit = estimateSplitY(image)
      setSplitRatio(autoSplit / image.height)

      try {
        const output = analyzeWorkshopImageData(image, {
          fullPalette,
          splitY: autoSplit,
        })
        if (gen !== analyzeGenRef.current) return
        setResult(output)
        setSplitRatio(output.splitY / image.height)
      } catch (analyzeErr) {
        if (gen !== analyzeGenRef.current) return
        setResult(null)
        setError(
          analyzeErr instanceof Error
            ? analyzeErr.message
            : '未识别到可用颜色，请调整分隔线后重试',
        )
      }
    } catch (err) {
      if (gen !== analyzeGenRef.current) return
      setImageData(null)
      setResult(null)
      setError(err instanceof Error ? err.message : '无法读取图片')
    } finally {
      if (gen === analyzeGenRef.current) setBusy(false)
    }
  }

  const reanalyze = () => {
    if (!imageData) return
    void runAnalyze(imageData, splitRatioRef.current)
  }

  // Draw preview when result / highlight / zoom changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !result) return

    if (result.mode === 'grid' && result.pattern) {
      drawPattern(canvas, result.pattern, {
        cellSize: zoom,
        showGrid: true,
        showCodes: false,
        highlightCode,
      })
      return
    }

    if (result.mode === 'pixel' && result.pixel && result.patternPreview) {
      // zoom 6–32 maps to pixel scale ~1–4
      const pixelScale = Math.max(1, Math.min(4, Math.round(zoom / 8)))
      drawPixelPreview(
        canvas,
        result.patternPreview,
        result.pixel,
        result.colors,
        highlightCode,
        HIGHLIGHT_DIM_ALPHA,
        pixelScale,
      )
    }
  }, [result, highlightCode, zoom])

  const splitPercent = Math.round(splitRatio * 1000) / 10

  const onSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageData || !sourceWrapRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    updateSplitFromPointer(event.clientY)
  }

  const onSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    updateSplitFromPointer(event.clientY)
  }

  const onSplitPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    setDragging(false)
    if (imageData) {
      void runAnalyze(imageData, splitRatioRef.current)
    }
  }

  const updateSplitFromPointer = (clientY: number) => {
    const img = sourceImgRef.current
    if (!img || !imageData) return

    const imgRect = img.getBoundingClientRect()
    if (imgRect.height <= 0) return

    const localY = clientY - imgRect.top
    const ratio = Math.max(0.4, Math.min(0.92, localY / imgRect.height))
    setSplitRatio(ratio)
  }

  const toggleColor = (code: string) => {
    setHighlightCode((prev) => (prev === code ? null : code))
  }

  const modeLabel = result?.mode === 'grid' ? '格点识别' : result?.mode === 'pixel' ? '像素模式' : null

  const statsLabel = (() => {
    if (!result) return ''
    if (result.mode === 'grid' && result.pattern) {
      const filled = result.pattern.width * result.pattern.height - result.pattern.emptyCount
      return `${result.pattern.width} × ${result.pattern.height} · ${filled} 颗 · ${result.colors.length} 色`
    }
    if (result.pixel) {
      return `${result.pixel.width} × ${result.pixel.height} px · ${result.colors.length} 色`
    }
    return `${result.colors.length} 色`
  })()

  return (
    <div className="workshop-workspace">
      <div className="workshop-layout">
        <aside className="workshop-side">
          <div className="workshop-upload">
            <label className="workshop-upload-button">
              上传拼豆图纸
              <input type="file" accept={ACCEPT} onChange={handleFile} />
            </label>
            {fileName ? (
              <p className="workshop-hint">已选：{fileName}</p>
            ) : (
              <p className="workshop-hint">
                支持本工具导出的「上图下图例」PNG，以及同类第三方图纸（png / jpg / webp）。图片仅在本地处理。
              </p>
            )}
          </div>

          {sourceUrl && (
            <>
              <div>
                <span className="control-label" style={{ display: 'block', marginBottom: 8 }}>
                  图案 / 图例分界
                </span>
                <div
                  className="workshop-source-wrap"
                  ref={sourceWrapRef}
                  onPointerDown={onSplitPointerDown}
                  onPointerMove={onSplitPointerMove}
                  onPointerUp={onSplitPointerUp}
                  onPointerCancel={onSplitPointerUp}
                >
                  <div className="workshop-source-frame">
                    <img ref={sourceImgRef} src={sourceUrl} alt="上传的拼豆图纸" draggable={false} />
                    <div className="workshop-split-line" style={{ top: `${splitRatio * 100}%` }}>
                      <div className="workshop-split-handle">拖动分界 · {splitPercent}%</div>
                    </div>
                  </div>
                </div>
                <p className="workshop-hint">拖动绿线对齐图例上沿，松手后自动重新识别。</p>
              </div>

              <div className="workshop-actions">
                <button type="button" className="primary" onClick={reanalyze} disabled={busy || !imageData}>
                  重新识别
                </button>
                {highlightCode && (
                  <button type="button" onClick={() => setHighlightCode(null)} disabled={busy}>
                    取消高亮
                  </button>
                )}
              </div>
            </>
          )}

          {busy && <div className="workshop-loading">正在识别图纸…</div>}
          {error && <p className="workshop-error">{error}</p>}

          {result && (
            <>
              <div className={`workshop-mode-badge${result.mode === 'pixel' ? ' pixel' : ''}`}>
                模式：{modeLabel}
              </div>
              {result.legendFallback && (
                <p className="workshop-hint warn">未识别到图例色块，已按图案区估色</p>
              )}

              <div className="workshop-colors">
                <div className="workshop-colors-heading">
                  <span>用色 {result.colors.length}</span>
                  <small>屏幕色仅供参考</small>
                </div>
                <div className="workshop-color-grid" role="list">
                  {result.colors.map((color) => (
                    <button
                      key={color.code}
                      type="button"
                      className={`workshop-color-chip${highlightCode === color.code ? ' active' : ''}`}
                      onClick={() => toggleColor(color.code)}
                      title={`${color.code}${color.count ? ` · ${color.count}` : ''}`}
                    >
                      <i className="swatch" style={{ background: color.hex }} aria-hidden="true" />
                      <span>{color.code}</span>
                      {color.count > 0 && <span className="count">{color.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="workshop-main">
          <div className="workshop-toolbar">
            <div className="dimensions">{statsLabel || '上传图纸后在此预览'}</div>
            {result && (
              <label className="workshop-zoom">
                <span>缩放</span>
                <input
                  type="range"
                  min={6}
                  max={32}
                  step={1}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  aria-label="预览缩放"
                />
              </label>
            )}
          </div>

          <div className="workshop-stage">
            {!sourceUrl && (
              <div className="workshop-empty">
                <strong>拼豆工作间</strong>
                <span>上传已有拼豆图纸，按色号高亮分批拼豆。与「拼豆图纸」生成功能互补。</span>
              </div>
            )}
            {sourceUrl && !result && !busy && !error && (
              <div className="workshop-empty">
                <strong>等待识别</strong>
                <span>可拖动左侧分界线后点击「重新识别」。</span>
              </div>
            )}
            {result && <canvas ref={canvasRef} />}
          </div>
        </section>
      </div>
    </div>
  )
}
