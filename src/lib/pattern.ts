import type { BeadColor } from './palette'
import type { ImageAdjustments } from './presets'

export type PatternCell = BeadColor

export type BeadPattern = {
  width: number
  height: number
  cells: PatternCell[]
  counts: Map<string, number>
}

export type PatternOptions = {
  targetWidth: number
  palette: BeadColor[]
  /** 0 / undefined = unlimited */
  maxColors?: number
  adjustments?: ImageAdjustments
}

const colorDistance = (rgb: [number, number, number], candidate: BeadColor) => {
  const meanRed = (rgb[0] + candidate.rgb[0]) / 2
  const red = rgb[0] - candidate.rgb[0]
  const green = rgb[1] - candidate.rgb[1]
  const blue = rgb[2] - candidate.rgb[2]

  return Math.sqrt(
    (2 + meanRed / 256) * red * red +
      4 * green * green +
      (2 + (255 - meanRed) / 256) * blue * blue,
  )
}

const closestColor = (rgb: [number, number, number], palette: BeadColor[]) => {
  let closest = palette[0]
  let closestDistance = Number.POSITIVE_INFINITY

  for (const candidate of palette) {
    const distance = colorDistance(rgb, candidate)
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }

  return closest
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

/** Apply brightness → contrast → saturation in place on ImageData bytes. */
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
  const { targetWidth, palette, maxColors = 0, adjustments } = options

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
  if (adjustments) applyAdjustments(pixels, adjustments)

  const cells: PatternCell[] = []
  const counts = new Map<string, number>()
  const shouldQuantize = maxColors > 0 && maxColors < palette.length

  if (shouldQuantize) {
    const rgbPixels: RgbPixel[] = []
    for (let index = 0; index < pixels.length; index += 4) {
      rgbPixels.push([pixels[index], pixels[index + 1], pixels[index + 2]])
    }

    const { representatives, assignments } = medianCutQuantize(rgbPixels, maxColors)
    const mapped = representatives.map((rgb) => closestColor(rgb, palette))

    for (const assignment of assignments) {
      const matched = mapped[assignment]
      cells.push(matched)
      counts.set(matched.code, (counts.get(matched.code) ?? 0) + 1)
    }
  } else {
    for (let index = 0; index < pixels.length; index += 4) {
      const matched = closestColor([pixels[index], pixels[index + 1], pixels[index + 2]], palette)
      cells.push(matched)
      counts.set(matched.code, (counts.get(matched.code) ?? 0) + 1)
    }
  }

  return { width, height, cells, counts }
}

export type DrawOptions = {
  cellSize: number
  showGrid: boolean
  showCodes: boolean
  background?: string
}

export function drawPattern(
  canvas: HTMLCanvasElement,
  pattern: BeadPattern,
  options: DrawOptions,
) {
  const { cellSize, showGrid, showCodes, background = '#ffffff' } = options
  const dpr = window.devicePixelRatio || 1
  const logicalWidth = pattern.width * cellSize
  const logicalHeight = pattern.height * cellSize

  canvas.width = logicalWidth * dpr
  canvas.height = logicalHeight * dpr
  canvas.style.width = `${logicalWidth}px`
  canvas.style.height = `${logicalHeight}px`

  const context = canvas.getContext('2d')
  if (!context) return
  context.scale(dpr, dpr)
  context.fillStyle = background
  context.fillRect(0, 0, logicalWidth, logicalHeight)

  pattern.cells.forEach((bead, index) => {
    const x = (index % pattern.width) * cellSize
    const y = Math.floor(index / pattern.width) * cellSize
    context.fillStyle = bead.hex
    context.fillRect(x, y, cellSize, cellSize)

    if (showGrid && cellSize >= 7) {
      context.strokeStyle = 'rgba(31, 35, 34, 0.2)'
      context.lineWidth = 0.5
      context.strokeRect(x, y, cellSize, cellSize)
    }

    if (showCodes && cellSize >= 18) {
      const brightness = bead.rgb[0] * 0.299 + bead.rgb[1] * 0.587 + bead.rgb[2] * 0.114
      context.fillStyle = brightness > 155 ? '#202322' : '#ffffff'
      context.font = `600 ${Math.max(7, cellSize * 0.32)}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(bead.code, x + cellSize / 2, y + cellSize / 2)
    }
  })
}

export function exportPattern(pattern: BeadPattern, showCodes: boolean) {
  const canvas = document.createElement('canvas')
  const cellSize = showCodes ? 36 : 20
  drawPattern(canvas, pattern, { cellSize, showGrid: true, showCodes })
  canvas.toBlob((blob) => {
    if (!blob) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `pindou-${pattern.width}x${pattern.height}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  }, 'image/png')
}
