import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import { MARD_COLORS } from '../../lib/palettes'
import type { BeadColor } from '../../lib/palette'
import {
  applyCorrections,
  clampSplitY,
  clusterUncertainColors,
  drawPixelPreview,
  drawUncertainHighlight,
  estimateSplitY,
  extractLegendCandidates,
  fileToImageData,
  recognizePattern,
  type RecognitionWithUncertain,
  type UncertainCluster,
  type WorkshopAnalyzeOutput,
  type WorkshopPhase,
} from '../../lib/workshop/analyze'
import { drawPattern, HIGHLIGHT_DIM_ALPHA } from '../../lib/pattern'
import type { PublicUser } from '../auth/authApi'
import type {
  InventorySnapshot,
  InventoryUsageSnapshot,
  ShortageItem,
  LowStockItem,
  DeductResponse,
} from '../../lib/inventory/types'
import {
  buildUsageSnapshot,
  calculateShortages,
  calculateLowStock,
  recordsToMap,
} from '../../lib/inventory/math'
import { deductInventory, InventoryRequestError } from '../inventory/inventoryApi'
import './workshop.css'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/*'

type BeadWorkshopTabProps = {
  sessionUser: PublicUser | null
  inventory: InventorySnapshot | null
  onInventoryDeducted: (snapshot: InventorySnapshot) => void
  onLogin: () => void
}

export default function BeadWorkshopTab({
  sessionUser,
  inventory,
  onInventoryDeducted,
  onLogin,
}: BeadWorkshopTabProps) {
  const [fileName, setFileName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const [splitRatio, setSplitRatio] = useState(0.78)

  // Three-phase state machine
  const [phase, setPhase] = useState<WorkshopPhase>('idle')
  const [candidates, setCandidates] = useState<BeadColor[]>([])
  const [legendFallback, setLegendFallback] = useState(false)
  const [confirmedPalette, setConfirmedPalette] = useState<BeadColor[]>([])
  const [recognition, setRecognition] = useState<RecognitionWithUncertain | null>(null)
  const [clusters, setClusters] = useState<UncertainCluster[]>([])
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null)
  /** clusterId → code | null (null = empty) */
  const [assignments, setAssignments] = useState<Record<number, string | null>>({})
  const [addPanelOpen, setAddPanelOpen] = useState(false)
  const [addSeriesFilter, setAddSeriesFilter] = useState<string | null>(null)
  const [addSearch, setAddSearch] = useState('')

  const [result, setResult] = useState<WorkshopAnalyzeOutput | null>(null)
  const [highlightCode, setHighlightCode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(14)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  // Inventory integration
  const [activeSession, setActiveSession] = useState<InventoryUsageSnapshot | null>(null)
  const [shortageItems, setShortageItems] = useState<ShortageItem[]>([])
  const [deductResult, setDeductResult] = useState<DeductResponse | null>(null)
  const [deductLowStock, setDeductLowStock] = useState<LowStockItem[]>([])
  const [inventoryBusy, setInventoryBusy] = useState(false)
  const [inventoryError, setInventoryError] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceWrapRef = useRef<HTMLDivElement>(null)
  const sourceImgRef = useRef<HTMLImageElement>(null)
  const analyzeGenRef = useRef(0)
  const splitRatioRef = useRef(splitRatio)
  splitRatioRef.current = splitRatio

  const fullPalette = useMemo(() => MARD_COLORS, [])

  const availableSeries = useMemo(() => {
    const set = new Set(fullPalette.map((c) => c.series))
    return [...set].sort()
  }, [fullPalette])

  const candidateCodes = useMemo(() => new Set(candidates.map((c) => c.code)), [candidates])

  const addableColors = useMemo(() => {
    let list = fullPalette.filter((c) => !candidateCodes.has(c.code))
    if (addSeriesFilter) list = list.filter((c) => c.series === addSeriesFilter)
    if (addSearch.trim()) {
      const q = addSearch.trim().toUpperCase()
      list = list.filter(
        (c) => c.code.toUpperCase().includes(q) || c.name.toUpperCase().includes(q),
      )
    }
    return list
  }, [fullPalette, candidateCodes, addSeriesFilter, addSearch])

  const assignedCount = useMemo(
    () => clusters.filter((c) => c.id in assignments).length,
    [clusters, assignments],
  )

  // Object URL lifecycle
  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    }
  }, [sourceUrl])

  // ---- Phase 1: extract legend ----

  const runLegendExtract = useCallback(
    (image: ImageData, ratio: number) => {
      const gen = ++analyzeGenRef.current
      setBusy(true)
      setError('')
      try {
        const splitY = clampSplitY(ratio * image.height, image.height)
        const extraction = extractLegendCandidates(image, splitY, fullPalette)
        if (gen !== analyzeGenRef.current) return
        setCandidates(extraction.colors)
        setLegendFallback(extraction.legendFallback)
        setPhase('palette')
        setResult(null)
        setRecognition(null)
        setClusters([])
        setAssignments({})
        setSelectedClusterId(null)
        setHighlightCode(null)
        setConfirmedPalette([])
        if (extraction.colors.length === 0) {
          setError('未识别到可用颜色，请调整分隔线或手动添加色号')
        }
      } catch (err) {
        if (gen !== analyzeGenRef.current) return
        setCandidates([])
        setPhase('palette')
        setError(err instanceof Error ? err.message : '提取色板失败，请调整分隔线后重试')
      } finally {
        if (gen === analyzeGenRef.current) setBusy(false)
      }
    },
    [fullPalette],
  )

  // ---- Phase 2: recognize with confirmed palette ----

  const runRecognize = useCallback(
    (image: ImageData, ratio: number, palette: BeadColor[], fallback: boolean) => {
      const gen = ++analyzeGenRef.current
      setBusy(true)
      setError('')
      setPhase('recognizing')
      try {
        const splitY = clampSplitY(ratio * image.height, image.height)
        const rec = recognizePattern(image, splitY, palette, fallback)
        if (gen !== analyzeGenRef.current) return
        setRecognition(rec)

        if (rec.uncertainSamples.length === 0) {
          // No uncertain → apply empty corrections → done
          const output = applyCorrections(rec, [], [], palette)
          setResult(output)
          setPhase('done')
          setHighlightCode(null)
        } else {
          const clustered = clusterUncertainColors(rec.uncertainSamples, 10)
          setClusters(clustered)
          setAssignments({})
          setSelectedClusterId(clustered.length > 0 ? clustered[0].id : null)
          setPhase('uncertain')
          setHighlightCode(null)
        }
      } catch (err) {
        if (gen !== analyzeGenRef.current) return
        setError(err instanceof Error ? err.message : '识别失败，请调整分隔线后重试')
        setPhase('palette')
      } finally {
        if (gen === analyzeGenRef.current) setBusy(false)
      }
    },
    [],
  )

  // ---- File upload ----

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
    setPhase('idle')
    setCandidates([])
    setRecognition(null)
    setClusters([])
    setAssignments({})
    // Clear inventory session on new upload
    setActiveSession(null)
    setShortageItems([])
    setDeductResult(null)
    setDeductLowStock([])

    const gen = ++analyzeGenRef.current
    try {
      const image = await fileToImageData(file)
      if (gen !== analyzeGenRef.current) return

      setImageData(image)
      const autoSplit = estimateSplitY(image)
      const ratio = autoSplit / image.height
      setSplitRatio(ratio)

      // Phase 1 only
      try {
        const extraction = extractLegendCandidates(image, autoSplit, fullPalette)
        if (gen !== analyzeGenRef.current) return
        setCandidates(extraction.colors)
        setLegendFallback(extraction.legendFallback)
        setPhase('palette')
        if (extraction.colors.length === 0) {
          setError('未识别到可用颜色，请调整分隔线或手动添加色号')
        }
      } catch (analyzeErr) {
        if (gen !== analyzeGenRef.current) return
        setPhase('palette')
        setError(
          analyzeErr instanceof Error
            ? analyzeErr.message
            : '未识别到可用颜色，请调整分隔线后重试',
        )
      }
    } catch (err) {
      if (gen !== analyzeGenRef.current) return
      setImageData(null)
      setPhase('idle')
      setError(err instanceof Error ? err.message : '无法读取图片')
    } finally {
      if (gen === analyzeGenRef.current) setBusy(false)
    }
  }

  // ---- Re-recognize = back to Phase 1 ----

  const reanalyze = () => {
    if (!imageData) return
    // If active inventory session, keep it but warn
    setResult(null)
    setRecognition(null)
    setClusters([])
    setAssignments({})
    setSelectedClusterId(null)
    setHighlightCode(null)
    setConfirmedPalette([])
    runLegendExtract(imageData, splitRatioRef.current)
  }

  // ---- Palette confirm handlers ----

  const removeCandidate = (code: string) => {
    setCandidates((prev) => prev.filter((c) => c.code !== code))
  }

  const addCandidate = (color: BeadColor) => {
    setCandidates((prev) => {
      if (prev.some((c) => c.code === color.code)) return prev
      return [...prev, color].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      )
    })
  }

  const confirmPalette = () => {
    if (candidates.length === 0) {
      setError('至少选择一个色号')
      return
    }
    if (!imageData) return
    setError('')
    setConfirmedPalette(candidates)
    runRecognize(imageData, splitRatioRef.current, candidates, legendFallback)
  }

  // ---- Phase 3: cluster assignment ----

  const assignCluster = (clusterId: number, code: string | null) => {
    setAssignments((prev) => ({ ...prev, [clusterId]: code }))
  }

  const finishWithCorrections = (skip: boolean) => {
    if (!recognition || confirmedPalette.length === 0) return

    const finalAssignments = skip
      ? clusters.map((c) => ({ clusterId: c.id, code: null as string | null }))
      : clusters.map((c) => ({
          clusterId: c.id,
          code: c.id in assignments ? assignments[c.id] : null,
        }))

    try {
      const output = applyCorrections(
        recognition,
        finalAssignments,
        clusters,
        confirmedPalette,
      )
      setResult(output)
      setPhase('done')
      setHighlightCode(null)
      setSelectedClusterId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用矫正失败')
    }
  }

  // ---- Canvas draw ----

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Phase 3: uncertain highlight
    if (phase === 'uncertain' && recognition) {
      drawUncertainHighlight(
        canvas,
        recognition,
        clusters,
        selectedClusterId,
        zoom,
        HIGHLIGHT_DIM_ALPHA,
      )
      return
    }

    // Phase done: final result
    if (phase === 'done' && result) {
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
    }
  }, [phase, result, recognition, clusters, selectedClusterId, highlightCode, zoom])

  // ---- Split drag ----

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
      // Re-extract legend only (back to Phase 1)
      setResult(null)
      setRecognition(null)
      setClusters([])
      setAssignments({})
      runLegendExtract(imageData, splitRatioRef.current)
    }
  }

  const updateSplitFromPointer = (clientY: number) => {
    const img = sourceImgRef.current
    if (!img || !imageData) return
    const imgRect = img.getBoundingClientRect()
    if (imgRect.height <= 0) return
    const localY = clientY - imgRect.top
    const raw = localY / imgRect.height
    const ratio = Math.max(0, Math.min(1, raw))
    setSplitRatio(ratio)
  }

  const toggleColor = (code: string) => {
    setHighlightCode((prev) => (prev === code ? null : code))
  }

  // ---- Inventory ----

  const hasUsageResult = !!(result && result.colors.some((c) => c.count > 0))
  const canStartInventory = !!(sessionUser && hasUsageResult && !activeSession)
  const canEndInventory = !!(activeSession && !inventoryBusy)

  const handleStart = useCallback(() => {
    if (!result || !hasUsageResult) return
    const snapshot = buildUsageSnapshot(result.colors)
    setActiveSession(snapshot)
    setDeductResult(null)
    setDeductLowStock([])
    const invMap = inventory ? recordsToMap(inventory.records) : new Map<string, number>()
    const shortages = calculateShortages(invMap, snapshot)
    setShortageItems(shortages)
    setInventoryError('')
  }, [result, hasUsageResult, inventory])

  const handleEnd = useCallback(async () => {
    if (!activeSession) return
    setInventoryBusy(true)
    setInventoryError('')
    try {
      const response = await deductInventory(activeSession.items, String(activeSession.createdAt))
      onInventoryDeducted(response)
      setDeductResult(response)
      const usedCodes = new Set(activeSession.items.map((i) => i.code))
      const lowStock = calculateLowStock(response, usedCodes)
      setDeductLowStock(lowStock)
      setActiveSession(null)
      setShortageItems([])
    } catch (err) {
      setInventoryError(err instanceof InventoryRequestError ? err.message : '扣减库存失败')
    } finally {
      setInventoryBusy(false)
    }
  }, [activeSession, onInventoryDeducted])

  const handleCancelSession = useCallback(() => {
    setActiveSession(null)
    setShortageItems([])
  }, [])

  const handleDismissResult = useCallback(() => {
    setDeductResult(null)
    setDeductLowStock([])
  }, [])

  // Keep inventory controls visible during re-recognize (result may be cleared while session locks usage).
  const reRecognizeAware = activeSession != null

  const modeLabel =
    result?.mode === 'grid'
      ? '格点识别'
      : result?.mode === 'pixel'
        ? '像素模式'
        : recognition?.mode === 'grid'
          ? '格点识别'
          : recognition?.mode === 'pixel'
            ? '像素模式'
            : null

  const statsLabel = (() => {
    if (result) {
      if (result.mode === 'grid' && result.pattern) {
        const filled =
          result.pattern.width * result.pattern.height - result.pattern.emptyCount
        return `${result.pattern.width} × ${result.pattern.height} · ${filled} 颗 · ${result.colors.length} 色`
      }
      if (result.pixel) {
        return `${result.pixel.width} × ${result.pixel.height} px · ${result.colors.length} 色`
      }
      return `${result.colors.length} 色`
    }
    if (recognition?.mode === 'grid' && recognition.pattern) {
      return `${recognition.pattern.width} × ${recognition.pattern.height} · 待矫正`
    }
    if (recognition?.pixel) {
      return `${recognition.pixel.width} × ${recognition.pixel.height} px · 待矫正`
    }
    return ''
  })()

  const showCanvas = phase === 'uncertain' || phase === 'done'

  // ---- RGB → CSS helper ----
  const rgbCss = (rgb: [number, number, number]) =>
    `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`

  return (
    <div className="workshop-workspace">
      <div className="workshop-layout">
        <aside className="workshop-side">
          {/* Upload */}
          <div className="workshop-upload">
            <label className="workshop-upload-button">
              上传拼豆图纸
              <input type="file" accept={ACCEPT} onChange={handleFile} />
            </label>
            {fileName ? (
              <p className="workshop-hint">已选：{fileName}</p>
            ) : (
              <p className="workshop-hint">
                支持本工具导出的「上图下图例」PNG，以及同类第三方图纸（png / jpg /
                webp）。图片仅在本地处理。
              </p>
            )}
          </div>

          {/* Source + split line */}
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
                    <img
                      ref={sourceImgRef}
                      src={sourceUrl}
                      alt="上传的拼豆图纸"
                      draggable={false}
                    />
                    <div
                      className="workshop-split-line"
                      style={{ top: `${splitRatio * 100}%` }}
                    >
                      <div className="workshop-split-handle">
                        拖动分界 · {splitPercent}%
                      </div>
                    </div>
                  </div>
                </div>
                <p className="workshop-hint">
                  拖动绿线对齐图例上沿，松手后重新提取色板。
                </p>
              </div>

              <div className="workshop-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={reanalyze}
                  disabled={busy || !imageData}
                >
                  重新识别
                </button>
                {highlightCode && phase === 'done' && (
                  <button type="button" onClick={() => setHighlightCode(null)} disabled={busy}>
                    取消高亮
                  </button>
                )}
              </div>
            </>
          )}

          {busy && (
            <div className="workshop-loading">
              {phase === 'recognizing' ? '正在识别图纸…' : '正在提取色板…'}
            </div>
          )}
          {error && <p className="workshop-error">{error}</p>}

          {/* ========== Phase 1: Palette confirm ========== */}
          {phase === 'palette' && !busy && (
            <div className="workshop-palette-confirm">
              <div className="workshop-colors-heading">
                <span>确认色板 · {candidates.length} 色</span>
                <small>屏幕色仅供参考</small>
              </div>
              {legendFallback && (
                <p className="workshop-hint warn">未识别到图例色块，已按图案区估色（建议色号）</p>
              )}
              {candidates.length === 0 ? (
                <p className="workshop-hint">色板为空，请手动添加色号</p>
              ) : (
                <div className="workshop-color-grid" role="list">
                  {candidates.map((color) => (
                    <div key={color.code} className="workshop-palette-chip">
                      <i className="swatch" style={{ background: color.hex }} aria-hidden="true" />
                      <span>{color.code}</span>
                      <button
                        type="button"
                        className="workshop-chip-delete"
                        onClick={() => removeCandidate(color.code)}
                        title={`删除 ${color.code}`}
                        aria-label={`删除 ${color.code}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="workshop-add-toggle"
                onClick={() => setAddPanelOpen((v) => !v)}
              >
                {addPanelOpen ? '收起添加' : '+ 添加色号'}
              </button>

              {addPanelOpen && (
                <div className="workshop-add-panel">
                  <input
                    type="search"
                    className="workshop-add-search"
                    placeholder="搜索色号…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    aria-label="搜索色号"
                  />
                  <div className="workshop-series-row" role="group" aria-label="系列筛选">
                    <button
                      type="button"
                      className={`chip-button series-chip${addSeriesFilter == null ? ' active' : ''}`}
                      onClick={() => setAddSeriesFilter(null)}
                    >
                      全部
                    </button>
                    {availableSeries.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`chip-button series-chip${addSeriesFilter === s ? ' active' : ''}`}
                        onClick={() =>
                          setAddSeriesFilter((prev) => (prev === s ? null : s))
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="workshop-add-list">
                    {addableColors.slice(0, 80).map((color) => (
                      <button
                        key={color.code}
                        type="button"
                        className="workshop-add-item"
                        onClick={() => addCandidate(color)}
                        title={`添加 ${color.code}`}
                      >
                        <i className="swatch" style={{ background: color.hex }} aria-hidden="true" />
                        <span>{color.code}</span>
                      </button>
                    ))}
                    {addableColors.length > 80 && (
                      <p className="workshop-hint">
                        仅显示前 80 个，请用系列或搜索缩小范围
                      </p>
                    )}
                    {addableColors.length === 0 && (
                      <p className="workshop-hint">没有可添加的色号</p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="workshop-confirm-btn primary"
                onClick={confirmPalette}
                disabled={candidates.length === 0 || busy}
              >
                确认色板
              </button>
            </div>
          )}

          {/* ========== Phase 3: Uncertain color resolution ========== */}
          {phase === 'uncertain' && recognition && (
            <div className="workshop-uncertain-section">
              {modeLabel && (
                <div
                  className={`workshop-mode-badge${recognition.mode === 'pixel' ? ' pixel' : ''}`}
                >
                  模式：{modeLabel}
                </div>
              )}

              <div className="workshop-colors-heading">
                <span>不确定颜色 · {clusters.length} 组</span>
                <small>
                  {assignedCount}/{clusters.length} 已决策
                </small>
              </div>
              <p className="workshop-hint">点击色块高亮对应区域，再选择归属色号或空格</p>

              <div className="workshop-cluster-grid" role="list">
                {clusters.map((cluster) => {
                  const assigned = cluster.id in assignments
                  const assignedCode = assignments[cluster.id]
                  return (
                    <button
                      key={cluster.id}
                      type="button"
                      className={`workshop-cluster-chip${selectedClusterId === cluster.id ? ' active' : ''}${assigned ? ' assigned' : ''}`}
                      onClick={() => setSelectedClusterId(cluster.id)}
                      title={
                        assigned
                          ? assignedCode
                            ? `已归为 ${assignedCode}`
                            : '已归为空格'
                          : '点击选择归属'
                      }
                    >
                      <i
                        className="swatch"
                        style={{ background: rgbCss(cluster.representative) }}
                        aria-hidden="true"
                      />
                      <span className="cluster-count">{cluster.count}</span>
                      {assigned && (
                        <span className="cluster-assign-label">
                          {assignedCode ?? '空'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {selectedClusterId != null && (
                <div className="workshop-assign-panel">
                  <p className="workshop-hint" style={{ fontWeight: 600 }}>
                    归属色号
                  </p>
                  <div className="workshop-color-grid">
                    {confirmedPalette.map((color) => (
                      <button
                        key={color.code}
                        type="button"
                        className={`workshop-color-chip${assignments[selectedClusterId] === color.code ? ' active' : ''}`}
                        onClick={() => assignCluster(selectedClusterId, color.code)}
                        title={color.code}
                      >
                        <i
                          className="swatch"
                          style={{ background: color.hex }}
                          aria-hidden="true"
                        />
                        <span>{color.code}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`workshop-color-chip workshop-empty-chip${assignments[selectedClusterId] === null && selectedClusterId in assignments ? ' active' : ''}`}
                      onClick={() => assignCluster(selectedClusterId, null)}
                      title="空格"
                    >
                      <i className="swatch empty-swatch" aria-hidden="true" />
                      <span>空格</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="workshop-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => finishWithCorrections(false)}
                  disabled={assignedCount < clusters.length}
                >
                  应用矫正
                </button>
                <button type="button" onClick={() => finishWithCorrections(true)}>
                  跳过，不确定色归空
                </button>
              </div>
            </div>
          )}

          {/* ========== Phase done: final result ========== */}
          {phase === 'done' && result && (
            <>
              <div
                className={`workshop-mode-badge${result.mode === 'pixel' ? ' pixel' : ''}`}
              >
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
                      <i
                        className="swatch"
                        style={{ background: color.hex }}
                        aria-hidden="true"
                      />
                      <span>{color.code}</span>
                      {color.count > 0 && <span className="count">{color.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Inventory: start only after done; active session stays visible through re-recognize */}
          {((hasUsageResult && phase === 'done') || activeSession != null || deductResult != null) && (
            <div className="workshop-inventory-section">
              <p className="workshop-inventory-heading">豆子库存</p>
              {!sessionUser ? (
                <p className="workshop-inventory-cta">
                  <button type="button" className="workshop-login-link" onClick={onLogin}>
                    登录
                  </button>
                  后可开始制作并自动扣减库存
                </p>
              ) : activeSession ? (
                <div className="inventory-start-section">
                  <p className="workshop-hint">
                    制作中：{activeSession.items.length} 个色号已锁定
                  </p>
                  <button
                    type="button"
                    className="workshop-end-btn"
                    onClick={() => void handleEnd()}
                    disabled={!canEndInventory}
                  >
                    {inventoryBusy ? '扣减中…' : '结束制作'}
                  </button>
                  <button type="button" onClick={handleCancelSession} disabled={inventoryBusy}>
                    取消
                  </button>
                  {reRecognizeAware && (
                    <p className="workshop-hint warn">
                      重新识别不会改变当前扣减用量，如需变更请先取消再重新开始。
                    </p>
                  )}
                  <div className="workshop-shortage">
                    <p className="workshop-hint" style={{ fontWeight: 600 }}>
                      本次用量快照
                    </p>
                    {activeSession.items.map((item) => (
                      <div key={item.code} className="workshop-shortage-item">
                        <span>{item.code}</span>
                        <span>{item.quantity} 颗</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="workshop-start-btn"
                  onClick={handleStart}
                  disabled={!canStartInventory}
                >
                  开始制作
                </button>
              )}

              {inventoryError && <p className="workshop-error">{inventoryError}</p>}

              {activeSession && shortageItems.length > 0 && (
                <div className="workshop-shortage">
                  <p className="workshop-hint warn" style={{ fontWeight: 600 }}>
                    库存不足（仍可继续制作）
                  </p>
                  {shortageItems.map((s) => (
                    <div key={s.code} className="workshop-shortage-item">
                      <span>{s.code}</span>
                      <span>
                        库存 {s.balance} 颗 · 需要 {s.needed} 颗 · 缺 {s.gap} 颗
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {deductResult && (
                <div className="workshop-shortage">
                  <p className="workshop-hint" style={{ fontWeight: 600 }}>
                    扣减完成
                  </p>
                  {deductResult.shortages.length > 0 && (
                    <p className="workshop-hint warn">
                      部分色号库存不足：{' '}
                      {deductResult.shortages
                        .map((s) => `${s.code} (缺 ${s.needed - s.deducted} 颗)`)
                        .join(', ')}
                    </p>
                  )}
                  {deductLowStock.length > 0 && (
                    <div>
                      <p className="workshop-hint warn" style={{ fontWeight: 600 }}>
                        建议补豆
                      </p>
                      {deductLowStock.map((ls) => (
                        <div key={ls.code} className="workshop-shortage-item">
                          <span>{ls.code}</span>
                          <span>
                            剩余 {ls.quantity} 颗 · 阈值 {ls.threshold} 颗
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={handleDismissResult}>
                    关闭
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        <section className="workshop-main">
          <div className="workshop-toolbar">
            <div className="dimensions">{statsLabel || '上传图纸后在此预览'}</div>
            {showCanvas && (
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
                <span>
                  上传已有拼豆图纸，按色号高亮分批拼豆。与「拼豆图纸」生成功能互补。
                </span>
              </div>
            )}
            {sourceUrl && phase === 'palette' && !busy && (
              <div className="workshop-empty">
                <strong>确认色板</strong>
                <span>请在左侧核对图例色号，删除误识别色或补充缺失色号后点「确认色板」。</span>
              </div>
            )}
            {sourceUrl && phase === 'idle' && !busy && !error && (
              <div className="workshop-empty">
                <strong>等待识别</strong>
                <span>可拖动左侧分界线后点击「重新识别」。</span>
              </div>
            )}
            {showCanvas && <canvas ref={canvasRef} />}
          </div>
        </section>
      </div>
    </div>
  )
}
