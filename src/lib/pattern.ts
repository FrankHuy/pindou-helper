import { closestColor } from './color-match'
import type { BeadColor } from './palette'
import type { ImageAdjustments } from './presets'

export type PatternCell = BeadColor | null

export type BeadPattern = {
  width: number
  height: number
  cells: PatternCell[]
  counts: Map<string, number>
  /** Number of null (empty / no-bead) cells */
  emptyCount: number
}

export type BackgroundRemoveOptions = {
  enabled: boolean
  /** Sample from original image; null = not sampled yet */
  sampleRgb: [number, number, number] | null
  /** 0–100 UI scale */
  tolerance: number
}

export type PatternOptions = {
  targetWidth: number
  palette: BeadColor[]
  /** 0 / undefined = unlimited */
  maxColors?: number
  adjustments?: ImageAdjustments
  backgroundRemove?: BackgroundRemoveOptions
  /** alpha below this → empty; default 16 */
  alphaThreshold?: number
}

const EMPTY_CELL_FILL = '#f0f2ef'
const DEFAULT_ALPHA_THRESHOLD = 16

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

/** Max channel delta ≤ tolerance * 2.55 (tolerance is 0–100 UI scale). */
function isNearSample(
  r: number,
  g: number,
  b: number,
  sample: [number, number, number],
  tolerance: number,
): boolean {
  const maxDelta = tolerance * 2.55
  return (
    Math.max(Math.abs(r - sample[0]), Math.abs(g - sample[1]), Math.abs(b - sample[2])) <= maxDelta
  )
}

/** Apply brightness → contrast → saturation in place on ImageData bytes (preserve alpha). */
function applyAdjustments(data: Uint8ClampedArray, adjustments: ImageAdjustments) {
  const { brightness, contrast, saturation } = adjustments
  if (brightness === 0 && contrast === 0 && saturation === 0) return

  const brightnessOffset = brightness * 2.55
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  const satFactor = 1 + saturation / 100

  for (let index = 0; index < data.length; index += 4) {
    let r = data[index]
    let g = data[index + 1]
    let b = data[index + 2]

    r += brightnessOffset
    g += brightnessOffset
    b += brightnessOffset

    r = contrastFactor * (r - 128) + 128
    g = contrastFactor * (g - 128) + 128
    b = contrastFactor * (b - 128) + 128

    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    r = gray + (r - gray) * satFactor
    g = gray + (g - gray) * satFactor
    b = gray + (b - gray) * satFactor

    data[index] = clampByte(r)
    data[index + 1] = clampByte(g)
    data[index + 2] = clampByte(b)
  }
}

type RgbPixel = [number, number, number]

type ColorBucket = {
  pixels: RgbPixel[]
  min: RgbPixel
  max: RgbPixel
}

function bucketBounds(pixels: RgbPixel[]): Pick<ColorBucket, 'min' | 'max'> {
  const min: RgbPixel = [255, 255, 255]
  const max: RgbPixel = [0, 0, 0]
  for (const [r, g, b] of pixels) {
    if (r < min[0]) min[0] = r
    if (g < min[1]) min[1] = g
    if (b < min[2]) min[2] = b
    if (r > max[0]) max[0] = r
    if (g > max[1]) max[1] = g
    if (b > max[2]) max[2] = b
  }
  return { min, max }
}

function splitBucket(bucket: ColorBucket): [ColorBucket, ColorBucket] | null {
  const ranges: RgbPixel = [
    bucket.max[0] - bucket.min[0],
    bucket.max[1] - bucket.min[1],
    bucket.max[2] - bucket.min[2],
  ]
  let channel = 0
  if (ranges[1] > ranges[channel]) channel = 1
  if (ranges[2] > ranges[channel]) channel = 2
  if (ranges[channel] === 0 || bucket.pixels.length < 2) return null

  const sorted = [...bucket.pixels].sort((a, b) => a[channel] - b[channel])
  const mid = Math.floor(sorted.length / 2)
  const leftPixels = sorted.slice(0, mid)
  const rightPixels = sorted.slice(mid)
  if (leftPixels.length === 0 || rightPixels.length === 0) return null

  const leftBounds = bucketBounds(leftPixels)
  const rightBounds = bucketBounds(rightPixels)
  return [
    { pixels: leftPixels, min: leftBounds.min, max: leftBounds.max },
    { pixels: rightPixels, min: rightBounds.min, max: rightBounds.max },
  ]
}

function bucketAverage(pixels: RgbPixel[]): RgbPixel {
  let r = 0
  let g = 0
  let b = 0
  for (const pixel of pixels) {
    r += pixel[0]
    g += pixel[1]
    b += pixel[2]
  }
  const n = pixels.length || 1
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

/**
 * Median-cut quantization: reduce pixels to at most maxColors representative RGBs,
 * then map each pixel to the nearest representative index.
 */
function medianCutQuantize(pixels: RgbPixel[], maxColors: number): {
  representatives: RgbPixel[]
  assignments: number[]
} {
  if (pixels.length === 0) return { representatives: [], assignments: [] }

  const bounds = bucketBounds(pixels)
  let buckets: ColorBucket[] = [{ pixels, min: bounds.min, max: bounds.max }]

  while (buckets.length < maxColors) {
    let bestIndex = -1
    let bestRange = -1
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i]
      const range = Math.max(
        bucket.max[0] - bucket.min[0],
        bucket.max[1] - bucket.min[1],
        bucket.max[2] - bucket.min[2],
      )
      if (range > bestRange && bucket.pixels.length > 1) {
        bestRange = range
        bestIndex = i
      }
    }
    if (bestIndex < 0) break

    const split = splitBucket(buckets[bestIndex])
    if (!split) break
    buckets = [...buckets.slice(0, bestIndex), split[0], split[1], ...buckets.slice(bestIndex + 1)]
  }

  const representatives = buckets.map((bucket) => bucketAverage(bucket.pixels))
  const assignments = new Array<number>(pixels.length)

  // Map original pixel order via nearest representative (stable for sparse buckets)
  for (let i = 0; i < pixels.length; i += 1) {
    const [r, g, b] = pixels[i]
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let j = 0; j < representatives.length; j += 1) {
      const rep = representatives[j]
      const dr = r - rep[0]
      const dg = g - rep[1]
      const db = b - rep[2]
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = j
      }
    }
    assignments[i] = best
  }

  return { representatives, assignments }
}

export async function createPattern(file: File, options: PatternOptions): Promise<BeadPattern> {
  const {
    targetWidth,
    palette,
    maxColors = 0,
    adjustments,
    backgroundRemove,
    alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
  } = options

  if (!palette.length) {
    throw new Error('请至少启用一种颜色')
  }

  const bitmap = await createImageBitmap(file)
  const width = Math.max(8, Math.min(160, Math.round(targetWidth)))
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) throw new Error('当前浏览器无法处理图片。')

  context.imageSmoothingEnabled = true
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data

  // Build empty mask on pre-adjust colors (alpha + optional color-key)
  const pixelCount = width * height
  const emptyMask = new Uint8Array(pixelCount)
  const bgEnabled = Boolean(backgroundRemove?.enabled && backgroundRemove.sampleRgb)
  const sampleRgb = backgroundRemove?.sampleRgb ?? null
  const tolerance = backgroundRemove?.tolerance ?? 32

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const a = pixels[i + 3]
    if (a < alphaThreshold) {
      emptyMask[p] = 1
      continue
    }
    if (
      bgEnabled &&
      sampleRgb &&
      isNearSample(pixels[i], pixels[i + 1], pixels[i + 2], sampleRgb, tolerance)
    ) {
      emptyMask[p] = 1
    }
  }

  if (adjustments) applyAdjustments(pixels, adjustments)

  const cells: PatternCell[] = new Array(pixelCount)
  const counts = new Map<string, number>()
  const shouldQuantize = maxColors > 0 && maxColors < palette.length

  if (shouldQuantize) {
    // Collect only non-empty pixels for median-cut
    const rgbPixels: RgbPixel[] = []
    const nonEmptyIndices: number[] = []
    for (let p = 0; p < pixelCount; p += 1) {
      if (emptyMask[p]) {
        cells[p] = null
        continue
      }
      const i = p * 4
      rgbPixels.push([pixels[i], pixels[i + 1], pixels[i + 2]])
      nonEmptyIndices.push(p)
    }

    if (rgbPixels.length > 0) {
      const { representatives, assignments } = medianCutQuantize(rgbPixels, maxColors)
      const mapped = representatives.map((rgb) => closestColor(rgb, palette))

      for (let k = 0; k < assignments.length; k += 1) {
        const matched = mapped[assignments[k]]
        const p = nonEmptyIndices[k]
        cells[p] = matched
        counts.set(matched.code, (counts.get(matched.code) ?? 0) + 1)
      }
    }
  } else {
    for (let p = 0; p < pixelCount; p += 1) {
      if (emptyMask[p]) {
        cells[p] = null
        continue
      }
      const i = p * 4
      const matched = closestColor([pixels[i], pixels[i + 1], pixels[i + 2]], palette)
      cells[p] = matched
      counts.set(matched.code, (counts.get(matched.code) ?? 0) + 1)
    }
  }

  let emptyCount = 0
  for (let p = 0; p < pixelCount; p += 1) {
    if (cells[p] == null) emptyCount += 1
  }

  return { width, height, cells, counts, emptyCount }
}

export type DrawOptions = {
  cellSize: number
  showGrid: boolean
  showCodes: boolean
  background?: string
  /** Preview only: focus one code; null/undefined = no highlight */
  highlightCode?: string | null
}

export type LegendEntry = {
  code: string
  count: number
  hex: string
}

type LegendChip = {
  entry: LegendEntry
  x: number
  y: number
  width: number
}

type LegendLayout = {
  width: number
  height: number
  title: string
  summary: string
  chips: LegendChip[]
  padding: number
  titleY: number
  summaryY: number
  titleFontSize: number
  summaryFontSize: number
  chipFontSize: number
  swatchSize: number
}

export const HIGHLIGHT_DIM_ALPHA = 0.38

function sizeCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(logicalWidth * dpr))
  canvas.height = Math.max(1, Math.round(logicalHeight * dpr))
  canvas.style.width = `${logicalWidth}px`
  canvas.style.height = `${logicalHeight}px`

  const context = canvas.getContext('2d')
  if (!context) return null
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  return context
}

function cellBrightness(bead: BeadColor) {
  return bead.rgb[0] * 0.299 + bead.rgb[1] * 0.587 + bead.rgb[2] * 0.114
}

function paintPattern(
  context: CanvasRenderingContext2D,
  pattern: BeadPattern,
  options: DrawOptions,
  originY = 0,
) {
  const { cellSize, showGrid, showCodes, background = '#ffffff', highlightCode } = options
  const logicalWidth = pattern.width * cellSize
  const logicalHeight = pattern.height * cellSize
  const highlightActive = Boolean(highlightCode)

  context.fillStyle = background
  context.fillRect(0, originY, logicalWidth, logicalHeight)

  // Fills (+ focus stroke when highlighting non-empty focus cells)
  pattern.cells.forEach((bead, index) => {
    const x = (index % pattern.width) * cellSize
    const y = originY + Math.floor(index / pattern.width) * cellSize

    if (bead == null) {
      context.globalAlpha = 1
      context.fillStyle = EMPTY_CELL_FILL
      context.fillRect(x, y, cellSize, cellSize)
      return
    }

    const isFocus = !highlightActive || bead.code === highlightCode

    context.globalAlpha = isFocus ? 1 : HIGHLIGHT_DIM_ALPHA
    context.fillStyle = bead.hex
    context.fillRect(x, y, cellSize, cellSize)

    if (highlightActive && isFocus && cellSize >= 4) {
      const brightness = cellBrightness(bead)
      context.strokeStyle = brightness > 155 ? 'rgba(32, 35, 34, 0.9)' : 'rgba(255, 255, 255, 0.95)'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1)
    }
  })

  context.globalAlpha = 1

  // Grid after fills so structure stays visible under dimming (includes empty cells)
  if (showGrid && cellSize >= 7) {
    context.strokeStyle = 'rgba(31, 35, 34, 0.2)'
    context.lineWidth = 0.5
    for (let row = 0; row < pattern.height; row += 1) {
      for (let col = 0; col < pattern.width; col += 1) {
        const x = col * cellSize
        const y = originY + row * cellSize
        context.strokeRect(x, y, cellSize, cellSize)
      }
    }
  }

  if (showCodes && cellSize >= 18) {
    context.font = `600 ${Math.max(7, cellSize * 0.32)}px system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    pattern.cells.forEach((bead, index) => {
      if (bead == null) return
      const x = (index % pattern.width) * cellSize
      const y = originY + Math.floor(index / pattern.width) * cellSize
      const isFocus = !highlightActive || bead.code === highlightCode
      context.globalAlpha = isFocus ? 1 : HIGHLIGHT_DIM_ALPHA
      const brightness = cellBrightness(bead)
      context.fillStyle = brightness > 155 ? '#202322' : '#ffffff'
      context.fillText(bead.code, x + cellSize / 2, y + cellSize / 2)
    })
    context.globalAlpha = 1
  }
}

export function drawPattern(
  canvas: HTMLCanvasElement,
  pattern: BeadPattern,
  options: DrawOptions,
) {
  const logicalWidth = pattern.width * options.cellSize
  const logicalHeight = pattern.height * options.cellSize
  const context = sizeCanvas(canvas, logicalWidth, logicalHeight)
  if (!context) return
  paintPattern(context, pattern, options)
}

export function buildUsageLegend(pattern: BeadPattern): LegendEntry[] {
  const hexByCode = new Map<string, string>()
  for (const cell of pattern.cells) {
    if (cell == null) continue
    if (!hexByCode.has(cell.code)) hexByCode.set(cell.code, cell.hex)
  }

  const entries: LegendEntry[] = []
  for (const [code, count] of pattern.counts) {
    if (count <= 0) continue
    entries.push({
      code,
      count,
      hex: hexByCode.get(code) ?? '#cccccc',
    })
  }

  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.code.localeCompare(b.code, undefined, { numeric: true })
  })
  return entries
}

export function layoutLegend(entries: LegendEntry[], width: number): LegendLayout {
  const padding = 16
  const titleFontSize = 14
  const summaryFontSize = 12
  const chipFontSize = 12
  const swatchSize = 12
  const swatchTextGap = 5
  const chipGapX = 12
  const chipGapY = 10
  const title = '用色统计'
  const totalBeads = entries.reduce((sum, entry) => sum + entry.count, 0)
  const summary = `${entries.length} 色 · 共 ${totalBeads} 豆`

  const measure = document.createElement('canvas').getContext('2d')
  const measureText = (text: string, font: string) => {
    if (!measure) return text.length * 7
    measure.font = font
    return measure.measureText(text).width
  }

  const chipFont = `600 ${chipFontSize}px system-ui, sans-serif`

  const titleY = padding + titleFontSize
  const summaryY = titleY + 8 + summaryFontSize
  let cursorX = padding
  let cursorY = summaryY + 14
  let rowHeight = Math.max(swatchSize, chipFontSize)
  const chips: LegendChip[] = []
  const contentRight = width - padding

  for (const entry of entries) {
    const label = `${entry.code}:${entry.count}`
    const textWidth = measureText(label, chipFont)
    const chipWidth = swatchSize + swatchTextGap + textWidth

    if (cursorX > padding && cursorX + chipWidth > contentRight) {
      cursorX = padding
      cursorY += rowHeight + chipGapY
    }

    chips.push({ entry, x: cursorX, y: cursorY, width: chipWidth })
    cursorX += chipWidth + chipGapX
  }

  const bottom = entries.length === 0 ? summaryY : cursorY + rowHeight
  const height = bottom + padding

  return {
    width,
    height,
    title,
    summary,
    chips,
    padding,
    titleY,
    summaryY,
    titleFontSize,
    summaryFontSize,
    chipFontSize,
    swatchSize,
  }
}

export function drawLegend(
  context: CanvasRenderingContext2D,
  layout: LegendLayout,
  originY: number,
) {
  const {
    width,
    height,
    title,
    summary,
    chips,
    padding,
    titleY,
    summaryY,
    titleFontSize,
    summaryFontSize,
    chipFontSize,
    swatchSize,
  } = layout

  context.fillStyle = '#ffffff'
  context.fillRect(0, originY, width, height)

  // Top separator line
  context.strokeStyle = 'rgba(31, 35, 34, 0.18)'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(padding, originY + 0.5)
  context.lineTo(width - padding, originY + 0.5)
  context.stroke()

  context.fillStyle = '#202523'
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.font = `700 ${titleFontSize}px system-ui, sans-serif`
  context.fillText(title, padding, originY + titleY)

  context.fillStyle = '#5f6763'
  context.font = `500 ${summaryFontSize}px system-ui, sans-serif`
  context.fillText(summary, padding, originY + summaryY)

  const chipFont = `600 ${chipFontSize}px system-ui, sans-serif`
  context.font = chipFont
  context.textBaseline = 'middle'

  for (const chip of chips) {
    const y = originY + chip.y
    const swatchY = y + (Math.max(swatchSize, chipFontSize) - swatchSize) / 2

    context.fillStyle = chip.entry.hex
    context.fillRect(chip.x, swatchY, swatchSize, swatchSize)
    context.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    context.lineWidth = 1
    context.strokeRect(chip.x + 0.5, swatchY + 0.5, swatchSize - 1, swatchSize - 1)

    context.fillStyle = '#202523'
    context.fillText(
      `${chip.entry.code}:${chip.entry.count}`,
      chip.x + swatchSize + 5,
      y + Math.max(swatchSize, chipFontSize) / 2,
    )
  }
}

export function exportPattern(pattern: BeadPattern, showCodes: boolean) {
  const cellSize = showCodes ? 36 : 20
  const patternWidth = pattern.width * cellSize
  const patternHeight = pattern.height * cellSize
  const gap = 8
  const entries = buildUsageLegend(pattern)
  const legend = layoutLegend(entries, patternWidth)
  const totalHeight = patternHeight + gap + legend.height

  const canvas = document.createElement('canvas')
  const context = sizeCanvas(canvas, patternWidth, totalHeight)
  if (!context) return

  // Full-canvas white so the pattern/legend gap is never transparent
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, patternWidth, totalHeight)

  // Pattern region — never apply preview highlight
  paintPattern(context, pattern, {
    cellSize,
    showGrid: true,
    showCodes,
    highlightCode: null,
  })
  drawLegend(context, legend, patternHeight + gap)

  canvas.toBlob((blob) => {
    if (!blob) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `pindou-${pattern.width}x${pattern.height}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  }, 'image/png')
}
