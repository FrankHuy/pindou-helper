import type { BeadColor } from '../palette'
import type { BeadPattern, PatternCell } from '../pattern'
import { mapRgbToBead } from './empty'
import { medianByte } from './image-data'

const MIN_CELL = 4
const MAX_CELL = 80
const MIN_DIM = 8
const MAX_DIM = 200
const STABLE_RATIO = 0.7

/**
 * Try to reconstruct a BeadPattern from a regular grid in the pattern crop.
 * Returns null when confidence gates fail (caller should use pixel path).
 */
export function tryBuildGridPattern(
  patternRegion: ImageData,
  palette: BeadColor[],
): BeadPattern | null {
  if (palette.length === 0) return null
  const { width, height } = patternRegion
  if (width < MIN_CELL * MIN_DIM || height < MIN_CELL * MIN_DIM) return null

  const cellSize = detectCellSize(patternRegion)
  if (cellSize == null || cellSize < MIN_CELL || cellSize > MAX_CELL) return null

  const origin = estimateOrigin(patternRegion, cellSize)
  const cols = Math.floor((width - origin.x) / cellSize)
  const rows = Math.floor((height - origin.y) / cellSize)

  if (cols < MIN_DIM || rows < MIN_DIM || cols > MAX_DIM || rows > MAX_DIM) return null
  // Leftover margins shouldn't dominate
  const coverageX = (cols * cellSize) / width
  const coverageY = (rows * cellSize) / height
  if (coverageX < 0.82 || coverageY < 0.82) return null

  const cells: PatternCell[] = new Array(cols * rows)
  const counts = new Map<string, number>()
  let emptyCount = 0
  let stable = 0

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = origin.x + col * cellSize
      const cy = origin.y + row * cellSize
      const sample = sampleCell(patternRegion, cx, cy, cellSize)
      const bead = mapRgbToBead(sample.r, sample.g, sample.b, palette)
      const index = row * cols + col
      cells[index] = bead

      if (bead == null) {
        emptyCount += 1
        if (sample.stable) stable += 1
      } else {
        counts.set(bead.code, (counts.get(bead.code) ?? 0) + 1)
        if (sample.stable) stable += 1
      }
    }
  }

  const total = cols * rows
  if (stable / total < STABLE_RATIO) return null
  // Must have some real beads
  if (counts.size === 0) return null
  // Too many empties often means wrong cell size / phase
  if (emptyCount / total > 0.92) return null

  return {
    width: cols,
    height: rows,
    cells,
    counts,
    emptyCount,
  }
}

function detectCellSize(image: ImageData): number | null {
  const hProj = edgeProjection(image, 'horizontal')
  const vProj = edgeProjection(image, 'vertical')

  const hPeriod = dominantPeriod(hProj)
  const vPeriod = dominantPeriod(vProj)

  if (hPeriod == null && vPeriod == null) return null
  if (hPeriod != null && vPeriod != null) {
    // Prefer agreement
    if (Math.abs(hPeriod - vPeriod) <= 2) {
      return Math.round((hPeriod + vPeriod) / 2)
    }
    // Slight mismatch: prefer the stronger projection's period
    return hPeriod
  }
  return hPeriod ?? vPeriod
}

function edgeProjection(image: ImageData, axis: 'horizontal' | 'vertical'): Float64Array {
  const { width, height, data } = image
  if (axis === 'horizontal') {
    // Sum of horizontal gradients per row → detect horizontal grid lines
    const proj = new Float64Array(height)
    for (let y = 0; y < height; y += 1) {
      let sum = 0
      for (let x = 1; x < width; x += 1) {
        const i = (y * width + x) * 4
        const j = (y * width + x - 1) * 4
        const lum =
          Math.abs(data[i] - data[j]) +
          Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2])
        sum += lum
      }
      // Also vertical neighbor difference emphasizes grid lines
      if (y > 0) {
        let vsum = 0
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4
          const j = ((y - 1) * width + x) * 4
          vsum +=
            Math.abs(data[i] - data[j]) +
            Math.abs(data[i + 1] - data[j + 1]) +
            Math.abs(data[i + 2] - data[j + 2])
        }
        sum += vsum * 0.5
      }
      proj[y] = sum
    }
    return proj
  }

  // vertical: detect vertical grid lines via column projection
  const proj = new Float64Array(width)
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = 1; y < height; y += 1) {
      const i = (y * width + x) * 4
      const j = ((y - 1) * width + x) * 4
      sum +=
        Math.abs(data[i] - data[j]) +
        Math.abs(data[i + 1] - data[j + 1]) +
        Math.abs(data[i + 2] - data[j + 2])
    }
    if (x > 0) {
      let hsum = 0
      for (let y = 0; y < height; y += 2) {
        const i = (y * width + x) * 4
        const j = (y * width + x - 1) * 4
        hsum +=
          Math.abs(data[i] - data[j]) +
          Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2])
      }
      sum += hsum * 0.5
    }
    proj[x] = sum
  }
  return proj
}

/**
 * Autocorrelation peak search for dominant period in [MIN_CELL, MAX_CELL].
 */
function dominantPeriod(proj: Float64Array): number | null {
  const n = proj.length
  if (n < MIN_CELL * 4) return null

  // Normalize
  let mean = 0
  for (let i = 0; i < n; i += 1) mean += proj[i]
  mean /= n
  const centered = new Float64Array(n)
  for (let i = 0; i < n; i += 1) centered[i] = proj[i] - mean

  const minP = MIN_CELL
  const maxP = Math.min(MAX_CELL, Math.floor(n / 4))
  let bestP = -1
  let bestScore = -Infinity

  for (let period = minP; period <= maxP; period += 1) {
    let corr = 0
    let count = 0
    for (let i = 0; i + period < n; i += 1) {
      corr += centered[i] * centered[i + period]
      count += 1
    }
    if (count === 0) continue
    const score = corr / count
    // Prefer mid-range periods slightly for export cell sizes (~14–36)
    const bias = period >= 10 && period <= 40 ? 1.05 : 1
    const adjusted = score * bias
    if (adjusted > bestScore) {
      bestScore = adjusted
      bestP = period
    }
  }

  if (bestP < 0 || bestScore <= 0) return null

  // Refine: check local neighborhood for integer harmonics
  return bestP
}

function estimateOrigin(
  image: ImageData,
  cellSize: number,
): { x: number; y: number } {
  // Search phase offsets that maximize grid-line alignment
  const maxPhase = cellSize
  let bestX = 0
  let bestY = 0
  let bestScore = -Infinity

  const vProj = edgeProjection(image, 'vertical')
  const hProj = edgeProjection(image, 'horizontal')

  for (let ox = 0; ox < maxPhase; ox += 1) {
    let score = 0
    for (let x = ox; x < vProj.length; x += cellSize) {
      score += vProj[x] ?? 0
      // neighbors also often strong for thick lines
      if (x + 1 < vProj.length) score += (vProj[x + 1] ?? 0) * 0.5
    }
    if (score > bestScore) {
      bestScore = score
      bestX = ox
    }
  }

  bestScore = -Infinity
  for (let oy = 0; oy < maxPhase; oy += 1) {
    let score = 0
    for (let y = oy; y < hProj.length; y += cellSize) {
      score += hProj[y] ?? 0
      if (y + 1 < hProj.length) score += (hProj[y + 1] ?? 0) * 0.5
    }
    if (score > bestScore) {
      bestScore = score
      bestY = oy
    }
  }

  // Origin for cell content is just after the grid line
  const x = Math.min(bestX + 1, cellSize - 1)
  const y = Math.min(bestY + 1, cellSize - 1)
  return { x, y }
}

function sampleCell(
  image: ImageData,
  cellX: number,
  cellY: number,
  cellSize: number,
): { r: number; g: number; b: number; stable: boolean } {
  const { width, height, data } = image
  const inset = Math.max(1, Math.floor(cellSize * 0.25))
  const x0 = Math.max(0, Math.floor(cellX + inset))
  const y0 = Math.max(0, Math.floor(cellY + inset))
  const x1 = Math.min(width, Math.floor(cellX + cellSize - inset))
  const y1 = Math.min(height, Math.floor(cellY + cellSize - inset))

  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4
      rs.push(data[i])
      gs.push(data[i + 1])
      bs.push(data[i + 2])
    }
  }

  // Fallback to center pixel
  if (rs.length === 0) {
    const cx = Math.min(width - 1, Math.max(0, Math.floor(cellX + cellSize / 2)))
    const cy = Math.min(height - 1, Math.max(0, Math.floor(cellY + cellSize / 2)))
    const i = (cy * width + cx) * 4
    return { r: data[i], g: data[i + 1], b: data[i + 2], stable: true }
  }

  const r = medianByte(rs)
  const g = medianByte(gs)
  const b = medianByte(bs)

  // Stability: majority of samples near median
  let near = 0
  for (let k = 0; k < rs.length; k += 1) {
    const dr = Math.abs(rs[k] - r)
    const dg = Math.abs(gs[k] - g)
    const db = Math.abs(bs[k] - b)
    if (Math.max(dr, dg, db) <= 28) near += 1
  }
  const stable = near / rs.length >= 0.55

  return { r, g, b, stable }
}
