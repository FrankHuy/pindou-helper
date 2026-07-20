import { closestColor } from '../color-match'
import type { BeadColor } from '../palette'
import { isLightBackground } from './empty'
import { downscaleImageData, medianByte } from './image-data'

/**
 * Sample legend swatches → unique MARD colors (no OCR).
 * Looks for compact non-background square-ish blobs / solid fills.
 */
export function sampleLegendColors(
  legendRegion: ImageData,
  fullPalette: BeadColor[],
): BeadColor[] {
  if (fullPalette.length === 0 || legendRegion.width < 4 || legendRegion.height < 4) {
    return []
  }

  const work = downscaleImageData(legendRegion, 600)
  const swatches = findSwatchMedians(work)
  if (swatches.length === 0) {
    return sampleScatteredColors(work, fullPalette)
  }

  const byCode = new Map<string, BeadColor>()
  for (const rgb of swatches) {
    if (isLightBackground(rgb[0], rgb[1], rgb[2])) continue
    const matched = closestColor(rgb, fullPalette)
    if (!byCode.has(matched.code)) byCode.set(matched.code, matched)
  }

  return [...byCode.values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  )
}

/**
 * When no legend swatches found: mine unique colors from pattern region.
 */
export function mineColorsFromPattern(
  patternRegion: ImageData,
  fullPalette: BeadColor[],
  maxColors = 64,
): BeadColor[] {
  if (fullPalette.length === 0) return []

  const work = downscaleImageData(patternRegion, 400)
  const { data, width, height } = work
  const byCode = new Map<string, { color: BeadColor; count: number }>()
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80))

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (isLightBackground(r, g, b)) continue
      const matched = closestColor([r, g, b], fullPalette)
      const prev = byCode.get(matched.code)
      if (prev) prev.count += 1
      else byCode.set(matched.code, { color: matched, count: 1 })
    }
  }

  return [...byCode.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map((entry) => entry.color)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
}

function findSwatchMedians(image: ImageData): [number, number, number][] {
  const { width, height, data } = image
  // Flood-fill compact non-background components
  const visited = new Uint8Array(width * height)
  const results: [number, number, number][] = []
  const minArea = Math.max(16, Math.floor((width * height) * 0.00015))
  const maxArea = Math.floor((width * height) * 0.08)

  const isFg = (x: number, y: number) => {
    const i = (y * width + x) * 4
    if (data[i + 3] < 16) return false
    return !isLightBackground(data[i], data[i + 1], data[i + 2])
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x
      if (visited[idx] || !isFg(x, y)) continue

      // BFS component
      const queue = [idx]
      visited[idx] = 1
      let qi = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      const pixels: number[] = []

      while (qi < queue.length) {
        const cur = queue[qi++]
        const cx = cur % width
        const cy = Math.floor(cur / width)
        pixels.push(cur)
        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)

        // Cap huge regions early
        if (pixels.length > maxArea) break

        const neighbors = [
          cur - 1,
          cur + 1,
          cur - width,
          cur + width,
        ]
        for (const n of neighbors) {
          if (n < 0 || n >= width * height) continue
          const nx = n % width
          const ny = Math.floor(n / width)
          // Prevent wrap on horizontal neighbors
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue
          if (visited[n] || !isFg(nx, ny)) continue
          visited[n] = 1
          queue.push(n)
        }
      }

      const area = pixels.length
      if (area < minArea || area > maxArea) continue

      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      if (bw < 3 || bh < 3) continue

      // Prefer compact / square-ish chips (export legend uses ~12×12)
      const aspect = bw / bh
      if (aspect < 0.35 || aspect > 2.8) continue
      const fill = area / (bw * bh)
      if (fill < 0.35) continue

      // Skip very large "text/content" blobs that aren't chips
      const maxSide = Math.max(bw, bh)
      if (maxSide > Math.min(width, height) * 0.35) continue

      const rs: number[] = []
      const gs: number[] = []
      const bs: number[] = []
      // Sample interior
      const insetX = Math.max(0, Math.floor(bw * 0.2))
      const insetY = Math.max(0, Math.floor(bh * 0.2))
      for (const p of pixels) {
        const px = p % width
        const py = Math.floor(p / width)
        if (px < minX + insetX || px > maxX - insetX) continue
        if (py < minY + insetY || py > maxY - insetY) continue
        const i = p * 4
        rs.push(data[i])
        gs.push(data[i + 1])
        bs.push(data[i + 2])
      }
      if (rs.length < 4) {
        for (const p of pixels) {
          const i = p * 4
          rs.push(data[i])
          gs.push(data[i + 1])
          bs.push(data[i + 2])
        }
      }

      results.push([medianByte(rs), medianByte(gs), medianByte(bs)])
    }
  }

  // Also scan for solid rectangular fills (export swatches may be tiny)
  if (results.length < 2) {
    results.push(...scanSolidSquares(image))
  }

  return results
}

/** Scan for small solid color squares typical of export legend chips. */
function scanSolidSquares(image: ImageData): [number, number, number][] {
  const { width, height, data } = image
  const found: [number, number, number][] = []
  // Prefer export swatch size (~12); keep scan coarse for main-thread cost
  const sizes = [12, 16, 10, 20]
  const step = 4
  const maxFinds = 80

  for (const size of sizes) {
    if (size >= height || size >= width) continue
    for (let y = 0; y <= height - size; y += step) {
      for (let x = 0; x <= width - size; x += step) {
        const sample = sampleSolid(data, width, x, y, size)
        if (sample) {
          found.push(sample)
          if (found.length >= maxFinds) return found
        }
      }
    }
  }

  return found
}

function sampleSolid(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  size: number,
): [number, number, number] | null {
  const inset = Math.max(1, Math.floor(size * 0.2))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  let minL = 255
  let maxL = 0

  for (let dy = inset; dy < size - inset; dy += 1) {
    for (let dx = inset; dx < size - inset; dx += 1) {
      const i = ((y + dy) * width + (x + dx)) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (isLightBackground(r, g, b)) return null
      rs.push(r)
      gs.push(g)
      bs.push(b)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      minL = Math.min(minL, lum)
      maxL = Math.max(maxL, lum)
    }
  }

  if (rs.length < 4) return null
  // Require fairly uniform interior
  if (maxL - minL > 28) return null
  return [medianByte(rs), medianByte(gs), medianByte(bs)]
}

/** Last-resort: sample non-light pixels and nearest-MARD dedupe. */
function sampleScatteredColors(
  image: ImageData,
  fullPalette: BeadColor[],
): BeadColor[] {
  const byCode = new Map<string, BeadColor>()
  const { data, width, height } = image
  const step = Math.max(1, Math.floor(Math.min(width, height) / 40))

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (isLightBackground(r, g, b)) continue
      const matched = closestColor([r, g, b], fullPalette)
      byCode.set(matched.code, matched)
    }
  }

  return [...byCode.values()]
}
