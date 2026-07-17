import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import {
  ALL_SERIES,
  EXTENDED_SERIES,
  MARD_PACK_SIZES,
  resolvePalette,
  STANDARD_SERIES,
} from './lib/palettes'
import type { MerchantPackSize, PaletteRange } from './lib/palettes'
import type { BeadPattern } from './lib/pattern'
import { createPattern, drawPattern, exportPattern } from './lib/pattern'
import {
  ALL_IMAGE_PRESETS,
  IMAGE_PRESETS,
  matchImagePreset,
  NEUTRAL_PRESET,
} from './lib/presets'
import type { ImageAdjustments } from './lib/presets'

const UploadIcon = () => <span aria-hidden="true">+</span>
const DownloadIcon = () => <span aria-hidden="true">↓</span>

const MAX_COLOR_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 8, label: '8' },
  { value: 16, label: '16' },
  { value: 24, label: '24' },
  { value: 32, label: '32' },
  { value: 48, label: '48' },
] as const

const RANGE_OPTIONS: { id: PaletteRange; label: string; count: number }[] = [
  { id: 'full', label: '完整', count: 291 },
  { id: 'standard', label: '标准', count: 221 },
  { id: 'extended', label: '扩展', count: 70 },
]

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

  const [range, setRange] = useState<PaletteRange>('standard')
  const [merchantPack, setMerchantPack] = useState<MerchantPackSize>(null)
  const [seriesFilter, setSeriesFilter] = useState<string[] | null>(null)
  const [disabledColors, setDisabledColors] = useState<Set<string>>(() => new Set())
  const [maxColors, setMaxColors] = useState(0)
  const [adjustments, setAdjustments] = useState<ImageAdjustments>({
    brightness: NEUTRAL_PRESET.brightness,
    contrast: NEUTRAL_PRESET.contrast,
    saturation: NEUTRAL_PRESET.saturation,
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const debounceRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const latestRef = useRef({
    file,
    targetWidth,
    range,
    merchantPack,
    seriesFilter,
    disabledColors,
    maxColors,
    adjustments,
  })

  latestRef.current = {
    file,
    targetWidth,
    range,
    merchantPack,
    seriesFilter,
    disabledColors,
    maxColors,
    adjustments,
  }

  const resolved = useMemo(
    () =>
      resolvePalette({
        brand: 'MARD',
        range,
        merchantPack,
        seriesFilter,
        disabled: disabledColors,
      }),
    [range, merchantPack, seriesFilter, disabledColors],
  )

  const activePresetId = useMemo(() => matchImagePreset(adjustments), [adjustments])

  const availableSeries = useMemo(() => {
    if (merchantPack != null) {
      const set = new Set(resolved.baseColors.map((color) => color.series))
      return ALL_SERIES.filter((series) => set.has(series))
    }
    if (range === 'standard') return [...STANDARD_SERIES]
    if (range === 'extended') return [...EXTENDED_SERIES]
    return [...ALL_SERIES]
  }, [merchantPack, range, resolved.baseColors])

  useEffect(() => {
    if (!pattern || !canvasRef.current) return
    drawPattern(canvasRef.current, pattern, {
      cellSize: zoom,
      showGrid,
      showCodes,
    })
  }, [pattern, zoom, showGrid, showCodes])

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    },
    [imageUrl],
  )

  useEffect(
    () => () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  const colorUsage = useMemo(() => {
    const counts = pattern?.counts
    return resolved.scopedColors
      .map((bead) => ({
        ...bead,
        count: counts?.get(bead.code) ?? 0,
        disabled: disabledColors.has(bead.code),
      }))
      .sort((a, b) => {
        if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
        if (b.count !== a.count) return b.count - a.count
        return a.code.localeCompare(b.code, undefined, { numeric: true })
      })
  }, [pattern, resolved.scopedColors, disabledColors])

  const generate = useCallback(async () => {
    const snapshot = latestRef.current
    if (!snapshot.file) return

    const palette = resolvePalette({
      brand: 'MARD',
      range: snapshot.range,
      merchantPack: snapshot.merchantPack,
      seriesFilter: snapshot.seriesFilter,
      disabled: snapshot.disabledColors,
    })

    if (!palette.colors.length) {
      setError('请至少启用一种颜色')
      setPattern(null)
      setBusy(false)
      return
    }

    const token = ++generationRef.current
    setBusy(true)
    setError('')

    try {
      const result = await createPattern(snapshot.file, {
        targetWidth: snapshot.targetWidth,
        palette: palette.colors,
        maxColors: snapshot.maxColors,
        adjustments: snapshot.adjustments,
      })
      if (token !== generationRef.current) return
      setPattern(result)
      setView('pattern')
    } catch (reason) {
      if (token !== generationRef.current) return
      setError(reason instanceof Error ? reason.message : '图纸生成失败，请换一张图片重试。')
    } finally {
      if (token === generationRef.current) setBusy(false)
    }
  }, [])

  const scheduleGenerate = useCallback(() => {
    if (!latestRef.current.file) return
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void generate()
    }, 300)
  }, [generate])

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setFile(nextFile)
    setImageUrl(URL.createObjectURL(nextFile))
    // generate immediately for new file
    latestRef.current = { ...latestRef.current, file: nextFile }
    void generate()
  }

  const patchLatest = (partial: Partial<typeof latestRef.current>) => {
    latestRef.current = { ...latestRef.current, ...partial }
  }

  const updateWidth = (value: number) => {
    const next = Math.max(8, Math.min(160, value))
    setTargetWidth(next)
    patchLatest({ targetWidth: next })
    scheduleGenerate()
  }

  const setRangeAndRegen = (next: PaletteRange) => {
    setRange(next)
    // clearing pack when user intentionally picks a range keeps UX clear
    setMerchantPack(null)
    setSeriesFilter(null)
    patchLatest({ range: next, merchantPack: null, seriesFilter: null })
    scheduleGenerate()
  }

  const setMerchantPackAndRegen = (value: string) => {
    const next = value === '' ? null : (Number(value) as Exclude<MerchantPackSize, null>)
    setMerchantPack(next)
    setSeriesFilter(null)
    patchLatest({ merchantPack: next, seriesFilter: null })
    scheduleGenerate()
  }

  const toggleSeries = (series: string) => {
    const current = latestRef.current.seriesFilter
    const base = current ?? [...availableSeries]
    let next: string[] | null = base.includes(series)
      ? base.filter((item) => item !== series)
      : [...base, series]
    if (next.length === availableSeries.length && availableSeries.every((s) => next!.includes(s))) {
      next = null
    }
    setSeriesFilter(next)
    patchLatest({ seriesFilter: next })
    scheduleGenerate()
  }

  const resetSeriesFilter = () => {
    setSeriesFilter(null)
    patchLatest({ seriesFilter: null })
    scheduleGenerate()
  }

  const toggleDisabled = (code: string) => {
    const next = new Set(latestRef.current.disabledColors)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDisabledColors(next)
    patchLatest({ disabledColors: next })
    scheduleGenerate()
  }

  const updateMaxColors = (value: number) => {
    setMaxColors(value)
    patchLatest({ maxColors: value })
    scheduleGenerate()
  }

  const updateAdjustment = (key: keyof ImageAdjustments, value: number) => {
    const next = { ...latestRef.current.adjustments, [key]: value }
    setAdjustments(next)
    patchLatest({ adjustments: next })
    scheduleGenerate()
  }

  const applyPreset = (presetId: string) => {
    const preset =
      presetId === NEUTRAL_PRESET.id
        ? NEUTRAL_PRESET
        : IMAGE_PRESETS[presetId] ?? NEUTRAL_PRESET
    const next = {
      brightness: preset.brightness,
      contrast: preset.contrast,
      saturation: preset.saturation,
    }
    setAdjustments(next)
    patchLatest({ adjustments: next })
    scheduleGenerate()
  }

  const maxColorsLabel =
    maxColors > 0 ? `最大 ${maxColors}` : '不限色数'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
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
              <button onClick={() => updateWidth(targetWidth - 4)} aria-label="减少宽度">
                −
              </button>
              <strong>
                {targetWidth}
                <small>颗</small>
              </strong>
              <button onClick={() => updateWidth(targetWidth + 4)} aria-label="增加宽度">
                +
              </button>
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
            <span className="control-label">颜色数量</span>
            <div className="chip-row" role="group" aria-label="最大颜色数">
              {MAX_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`chip-button${maxColors === option.value ? ' active' : ''}`}
                  onClick={() => updateMaxColors(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <span className="control-label">图片调整</span>
            <div className="chip-row preset-row" role="group" aria-label="调整预设">
              {ALL_IMAGE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`chip-button${activePresetId === preset.id ? ' active' : ''}`}
                  onClick={() => applyPreset(preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <label className="slider-row">
              <span>亮度 {adjustments.brightness}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.brightness}
                onChange={(event) => updateAdjustment('brightness', Number(event.target.value))}
              />
            </label>
            <label className="slider-row">
              <span>对比度 {adjustments.contrast}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.contrast}
                onChange={(event) => updateAdjustment('contrast', Number(event.target.value))}
              />
            </label>
            <label className="slider-row">
              <span>饱和度 {adjustments.saturation}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments.saturation}
                onChange={(event) => updateAdjustment('saturation', Number(event.target.value))}
              />
            </label>
          </div>

          <div className="control-group">
            <span className="control-label">显示</span>
            <label className="toggle-row">
              <span>网格</span>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => setShowGrid(event.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>色号</span>
              <input
                type="checkbox"
                checked={showCodes}
                onChange={(event) => setShowCodes(event.target.checked)}
              />
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
              <button
                className={view === 'pattern' ? 'active' : ''}
                onClick={() => setView('pattern')}
              >
                图纸
              </button>
              <button
                className={view === 'source' ? 'active' : ''}
                onClick={() => setView('source')}
                disabled={!imageUrl}
              >
                原图
              </button>
            </div>
            {pattern && (
              <span className="dimensions">
                {pattern.width} × {pattern.height} · {pattern.cells.length} 颗 · 用色{' '}
                {pattern.counts.size}
              </span>
            )}
          </div>

          <div className="stage">
            {!file && (
              <label className="empty-state">
                <span className="empty-icon">
                  <UploadIcon />
                </span>
                <strong>选择一张图片</strong>
                <span>支持照片、插画和像素图</span>
                <input type="file" accept="image/*" onChange={handleFile} />
              </label>
            )}
            {busy && <div className="loading">正在生成图纸…</div>}
            {error && <div className="error-message">{error}</div>}
            {file && view === 'pattern' && <canvas ref={canvasRef} />}
            {file && view === 'source' && (
              <img className="source-image" src={imageUrl} alt="上传的原图" />
            )}
          </div>
        </section>

        <aside className="palette-panel">
          <div className="palette-heading">
            <div>
              <span>{resolved.label}</span>
              <strong>
                生效 {resolved.colors.length} / {resolved.totalInScope}
              </strong>
            </div>
            <span className="palette-note">屏幕色仅供参考 · {maxColorsLabel}</span>
          </div>

          <div className="palette-controls">
            <div className="palette-section">
              <span className="control-label">色号范围</span>
              <div className={`chip-row${merchantPack != null ? ' dimmed' : ''}`} role="group">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`chip-button${merchantPack == null && range === option.id ? ' active' : ''}`}
                    onClick={() => setRangeAndRegen(option.id)}
                    title={merchantPack != null ? '当前以商家套装为准' : undefined}
                  >
                    {option.label}({option.count})
                  </button>
                ))}
              </div>
              {merchantPack != null && (
                <p className="palette-hint">已选商家套装，范围仅作参考</p>
              )}
            </div>

            <div className="palette-section">
              <span className="control-label">商家套装</span>
              <select
                aria-label="商家套装"
                className="pack-select"
                value={merchantPack ?? ''}
                onChange={(event) => setMerchantPackAndRegen(event.target.value)}
              >
                <option value="">不使用套装</option>
                {MARD_PACK_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} 色
                  </option>
                ))}
              </select>
            </div>

            <div className="palette-section">
              <div className="series-heading">
                <span className="control-label">系列筛选</span>
                <button type="button" className="text-button" onClick={resetSeriesFilter}>
                  全选
                </button>
              </div>
              <div className="chip-row series-row" role="group" aria-label="系列筛选">
                {availableSeries.map((series) => {
                  const active = seriesFilter == null || seriesFilter.includes(series)
                  return (
                    <button
                      key={series}
                      type="button"
                      className={`chip-button series-chip${active ? ' active' : ''}`}
                      onClick={() => toggleSeries(series)}
                    >
                      {series}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {colorUsage.length === 0 ? (
            <p className="palette-empty">当前筛选下没有可用颜色</p>
          ) : (
            <div className="color-list">
              {colorUsage.map((bead) => (
                <button
                  type="button"
                  className={`color-row${bead.disabled ? ' disabled' : ''}`}
                  key={bead.code}
                  onClick={() => toggleDisabled(bead.code)}
                  title={bead.disabled ? '点击启用此色' : '点击禁用此色'}
                >
                  <span className="swatch" style={{ backgroundColor: bead.hex }} />
                  <span className="color-code">{bead.code}</span>
                  <span className="color-name">{bead.name}</span>
                  <strong>{bead.disabled ? '禁用' : bead.count}</strong>
                </button>
              ))}
            </div>
          )}
        </aside>
      </section>
    </main>
  )
}

export default App
