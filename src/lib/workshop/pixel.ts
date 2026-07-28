import type { BeadColor } from '../palette'
import type { BeadPattern } from '../pattern'
import { drawPattern, HIGHLIGHT_DIM_ALPHA } from '../pattern'
import { classifyCell } from './classify'
import { mapRgbToBead } from './empty'
import { downscaleImageData } from './image-data'
import type {
  RecognitionWithUncertain,
  UncertainCluster,
  UncertainSample,
  WorkshopColor,
  WorkshopPixelModel,
} from './types'

const MAX_PIXEL_DIM = 800

export type PixelAssignment = {
  pixel: WorkshopPixelModel
  colors: WorkshopColor[]
  /** Pattern crop used for labeling (possibly downscaled) */
  preview: ImageData
}

/**
 * Per-pixel (or 2×2 block) assignment on pattern crop → labels + counts.
 */
export function buildPixelAssignment(
  patternRegion: ImageData,
  palette: BeadColor[],
): PixelAssignment {
  const work = downscaleImageData(patternRegion, MAX_PIXEL_DIM)
  const { width, height, data } = work
  const labels = new Int16Array(width * height)
  const counts = new Map<string, number>()
  const codeToIndex = new Map<string, number>()
  const colorList: BeadColor[] = []

  // 2×2 blocks for speed on larger images
  const block = width * height > 250_000 ? 2 : 1

  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      // Average block
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = 0; dy < block && y + dy < height; dy += 1) {
        for (let dx = 0; dx < block && x + dx < width; dx += 1) {
          const i = ((y + dy) * width + (x + dx)) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n += 1
        }
      }
      r = Math.round(r / n)
      g = Math.round(g / n)
      b = Math.round(b / n)

      const bead = mapRgbToBead(r, g, b, palette)
      let label = -1
      if (bead) {
        let idx = codeToIndex.get(bead.code)
        if (idx === undefined) {
          idx = colorList.length
          codeToIndex.set(bead.code, idx)
          colorList.push(bead)
        }
        label = idx
        counts.set(bead.code, (counts.get(bead.code) ?? 0) + n)
      }

      for (let dy = 0; dy < block && y + dy < height; dy += 1) {
        for (let dx = 0; dx < block && x + dx < width; dx += 1) {
          labels[(y + dy) * width + (x + dx)] = label
        }
      }
    }
  }

  const colors: WorkshopColor[] = colorList
    .map((c) => ({
      code: c.code,
      hex: c.hex,
      rgb: c.rgb,
      count: counts.get(c.code) ?? 0,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.code.localeCompare(b.code, undefined, { numeric: true })
    })

  // Remap labels to sorted color order
  const remap = new Map<string, number>()
  colors.forEach((c, i) => remap.set(c.code, i))
  const oldIndexToCode = colorList.map((c) => c.code)
  for (let i = 0; i < labels.length; i += 1) {
    const old = labels[i]
    if (old < 0) continue
    const code = oldIndexToCode[old]
    labels[i] = remap.get(code) ?? -1
  }

  return {
    pixel: { width, height, labels },
    colors,
    preview: work,
  }
}

export type PixelWithUncertain = {
  pixel: WorkshopPixelModel
  colors: WorkshopColor[]
  uncertainSamples: UncertainSample[]
  uncertainMask: Uint8Array
  preview: ImageData
}

/**
 * Like buildPixelAssignment but tracks uncertain pixels separately.
 * Uncertain = not background + distance > threshold.
 */
export function buildPixelAssignmentWithUncertain(
  patternRegion: ImageData,
  palette: BeadColor[],
): PixelWithUncertain {
  const work = downscaleImageData(patternRegion, MAX_PIXEL_DIM)
  const { width, height, data } = work
  const labels = new Int16Array(width * height)
  const uncertainMask = new Uint8Array(width * height)
  const uncertainSamples: UncertainSample[] = []
  const counts = new Map<string, number>()
  const codeToIndex = new Map<string, number>()
  const colorList: BeadColor[] = []

  const block = width * height > 250_000 ? 2 : 1

  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = 0; dy < block && y + dy < height; dy += 1) {
        for (let dx = 0; dx < block && x + dx < width; dx += 1) {
          const i = ((y + dy) * width + (x + dx)) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n += 1
        }
      }
      r = Math.round(r / n)
      g = Math.round(g / n)
      b = Math.round(b / n)

      const classification = classifyCell(r, g, b, palette)
      let label = -1

      if (classification.type === 'matched' && classification.color) {
        let idx = codeToIndex.get(classification.color.code)
        if (idx === undefined) {
          idx = colorList.length
          codeToIndex.set(classification.color.code, idx)
          colorList.push(classification.color)
        }
        label = idx
        counts.set(classification.color.code, (counts.get(classification.color.code) ?? 0) + n)
      } else if (classification.type === 'uncertain') {
        // Record one sample per block (use first pixel index)
        const sampleIndex = y * width + x
        uncertainSamples.push({ rgb: [r, g, b], index: sampleIndex })
        for (let dy = 0; dy < block && y + dy < height; dy += 1) {
          for (let dx = 0; dx < block && x + dx < width; dx += 1) {
            uncertainMask[(y + dy) * width + (x + dx)] = 1
          }
        }
      }

      for (let dy = 0; dy < block && y + dy < height; dy += 1) {
        for (let dx = 0; dx < block && x + dx < width; dx += 1) {
          labels[(y + dy) * width + (x + dx)] = label
        }
      }
    }
  }

  const colors: WorkshopColor[] = colorList
    .map((c) => ({
      code: c.code,
      hex: c.hex,
      rgb: c.rgb,
      count: counts.get(c.code) ?? 0,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.code.localeCompare(b.code, undefined, { numeric: true })
    })

  const remap = new Map<string, number>()
  colors.forEach((c, i) => remap.set(c.code, i))
  const oldIndexToCode = colorList.map((c) => c.code)
  for (let i = 0; i < labels.length; i += 1) {
    const old = labels[i]
    if (old < 0) continue
    const code = oldIndexToCode[old]
    labels[i] = remap.get(code) ?? -1
  }

  return {
    pixel: { width, height, labels },
    colors,
    uncertainSamples,
    uncertainMask,
    preview: work,
  }
}

/**
 * Map cluster sample-array indices → pattern cell/pixel indices.
 * Cluster.indices point into uncertainSamples[], not the pattern flat index.
 */
function patternIndicesForCluster(
  samples: UncertainSample[],
  cluster: UncertainCluster,
): Set<number> {
  const out = new Set<number>()
  for (const sampleIdx of cluster.indices) {
    const sample = samples[sampleIdx]
    if (sample) out.add(sample.index)
  }
  return out
}

/**
 * Expand block-origin sample indices onto neighboring uncertain mask pixels.
 * block=1: every uncertain pixel is a sample origin → no expansion.
 * block=2: only top-left is sampled → fill remaining 2×2 only where mask is set
 * and no other sample owns that pixel.
 */
export function expandUncertainAssignments(
  width: number,
  height: number,
  samples: UncertainSample[],
  sampleAssign: Map<number, BeadColor | null>,
  uncertainMask?: Uint8Array,
): Map<number, BeadColor | null> {
  const sampleOrigins = new Set(samples.map((s) => s.index))
  const blockAssign = new Map<number, BeadColor | null>()

  for (const [si, bead] of sampleAssign) {
    const sample = samples[si]
    if (!sample) continue
    const origin = sample.index
    blockAssign.set(origin, bead)

    if (!uncertainMask) continue
    const sx = origin % width
    const sy = Math.floor(origin / width)
    for (let dy = 0; dy < 2 && sy + dy < height; dy += 1) {
      for (let dx = 0; dx < 2 && sx + dx < width; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const ni = (sy + dy) * width + (sx + dx)
        if (uncertainMask[ni] !== 1) continue
        if (sampleOrigins.has(ni)) continue
        blockAssign.set(ni, bead)
      }
    }
  }

  return blockAssign
}

/**
 * Draw recognition with selected uncertain cluster highlighted.
 * Grid: build temp pattern with synthetic code for selected cluster cells.
 * Pixel: override pixels belonging to selected cluster.
 */
export function drawUncertainHighlight(
  canvas: HTMLCanvasElement,
  recognition: RecognitionWithUncertain,
  clusters: UncertainCluster[],
  selectedClusterId: number | null,
  zoom: number,
  dimAlpha = HIGHLIGHT_DIM_ALPHA,
) {
  const selected = selectedClusterId != null
    ? clusters.find((c) => c.id === selectedClusterId)
    : null

  if (recognition.mode === 'grid' && recognition.pattern) {
    drawGridUncertainHighlight(
      canvas,
      recognition.pattern,
      recognition.uncertainSamples,
      selected ?? null,
      zoom,
      dimAlpha,
    )
    return
  }

  if (recognition.mode === 'pixel' && recognition.pixel && recognition.patternPreview) {
    drawPixelUncertainHighlight(
      canvas,
      recognition.patternPreview,
      recognition.pixel,
      recognition.uncertainSamples,
      recognition.uncertainMask,
      selected ?? null,
      zoom,
      dimAlpha,
    )
  }
}

function drawGridUncertainHighlight(
  canvas: HTMLCanvasElement,
  pattern: BeadPattern,
  samples: UncertainSample[],
  selected: UncertainCluster | null,
  zoom: number,
  dimAlpha: number,
) {
  if (!selected) {
    drawPattern(canvas, pattern, {
      cellSize: zoom,
      showGrid: true,
      showCodes: false,
      highlightCode: null,
    })
    return
  }

  // selected.indices → uncertainSamples[] → pattern cell index
  const selectedCells = patternIndicesForCluster(samples, selected)

  const SYNTH_CODE = '__uncertain__'
  const synthColor: BeadColor = {
    brand: '',
    series: '',
    code: SYNTH_CODE,
    name: '',
    hex: rgbToHex(selected.representative),
    rgb: selected.representative,
  }

  const cells = pattern.cells.map((cell, i) => {
    if (selectedCells.has(i)) return synthColor
    return cell
  })
  const counts = new Map(pattern.counts)
  counts.set(SYNTH_CODE, selected.count)

  const temp: BeadPattern = {
    width: pattern.width,
    height: pattern.height,
    cells,
    counts,
    emptyCount: pattern.emptyCount,
  }

  drawPattern(canvas, temp, {
    cellSize: zoom,
    showGrid: true,
    showCodes: false,
    highlightCode: SYNTH_CODE,
  })
  void dimAlpha // drawPattern applies HIGHLIGHT_DIM_ALPHA for non-focus cells
}

function drawPixelUncertainHighlight(
  canvas: HTMLCanvasElement,
  preview: ImageData,
  model: WorkshopPixelModel,
  samples: UncertainSample[],
  uncertainMask: Uint8Array | undefined,
  selected: UncertainCluster | null,
  zoom: number,
  dimAlpha: number,
) {
  const { width, height, labels } = model
  const out = new ImageData(width, height)
  const src = preview.data
  const dst = out.data

  const highlightMask = new Uint8Array(width * height)
  if (selected) {
    // Map cluster sample-array indices → pattern pixel indices, then expand blocks
    const sampleAssign = new Map<number, BeadColor | null>()
    for (const sampleIdx of selected.indices) {
      sampleAssign.set(sampleIdx, null) // value unused; presence drives expansion
    }
    const expanded = expandUncertainAssignments(
      width,
      height,
      samples,
      sampleAssign,
      uncertainMask,
    )
    for (const idx of expanded.keys()) {
      highlightMask[idx] = 1
    }
  }

  for (let i = 0; i < labels.length; i++) {
    const p = i * 4
    const isHighlight = highlightMask[i] === 1

    if (isHighlight && selected) {
      dst[p] = selected.representative[0]
      dst[p + 1] = selected.representative[1]
      dst[p + 2] = selected.representative[2]
      dst[p + 3] = 255
    } else if (selected) {
      dst[p] = Math.round(src[p] * dimAlpha + 255 * (1 - dimAlpha) * 0.92)
      dst[p + 1] = Math.round(src[p + 1] * dimAlpha + 255 * (1 - dimAlpha) * 0.92)
      dst[p + 2] = Math.round(src[p + 2] * dimAlpha + 255 * (1 - dimAlpha) * 0.92)
      dst[p + 3] = 255
    } else {
      dst[p] = src[p]
      dst[p + 1] = src[p + 1]
      dst[p + 2] = src[p + 2]
      dst[p + 3] = 255
    }
  }

  const dpr = window.devicePixelRatio || 1
  const scale = Math.max(1, Math.min(4, Math.round(zoom / 8)))
  const logicalW = width * scale
  const logicalH = height * scale

  canvas.width = Math.max(1, Math.round(logicalW * dpr))
  canvas.height = Math.max(1, Math.round(logicalH * dpr))
  canvas.style.width = `${logicalW}px`
  canvas.style.height = `${logicalH}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  const tmp = document.createElement('canvas')
  tmp.width = width
  tmp.height = height
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(out, 0, 0)
  ctx.clearRect(0, 0, logicalW, logicalH)
  ctx.drawImage(tmp, 0, 0, logicalW, logicalH)
}

function rgbToHex(rgb: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`
}

/**
 * Draw pixel-mode preview with optional single-code highlight (dim others).
 */
export function drawPixelPreview(
  canvas: HTMLCanvasElement,
  preview: ImageData,
  model: WorkshopPixelModel,
  colors: WorkshopColor[],
  highlightCode: string | null,
  dimAlpha: number,
  /** Display scale multiplier (1–4 typical) */
  displayScale = 1,
) {
  const { width, height, labels } = model
  const out = new ImageData(width, height)
  const src = preview.data
  const dst = out.data

  let focusIndex = -1
  if (highlightCode) {
    focusIndex = colors.findIndex((c) => c.code === highlightCode)
  }

  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i]
    const p = i * 4
    const isFocus = focusIndex < 0 || label === focusIndex
    const alphaMul = highlightCode && !isFocus ? dimAlpha : 1

    if (label < 0) {
      // Keep light background visible but slightly muted when highlighting
      dst[p] = src[p]
      dst[p + 1] = src[p + 1]
      dst[p + 2] = src[p + 2]
      dst[p + 3] = Math.round(255 * (highlightCode ? Math.min(1, dimAlpha + 0.15) : 1))
      continue
    }

    // Prefer palette hex for focus clarity; mix with source for non-focus
    const color = colors[label]
    if (isFocus && highlightCode) {
      const hex = color.hex
      dst[p] = parseInt(hex.slice(1, 3), 16)
      dst[p + 1] = parseInt(hex.slice(3, 5), 16)
      dst[p + 2] = parseInt(hex.slice(5, 7), 16)
      dst[p + 3] = 255
    } else {
      dst[p] = Math.round(src[p] * alphaMul + 255 * (1 - alphaMul) * 0.92)
      dst[p + 1] = Math.round(src[p + 1] * alphaMul + 255 * (1 - alphaMul) * 0.92)
      dst[p + 2] = Math.round(src[p + 2] * alphaMul + 255 * (1 - alphaMul) * 0.92)
      dst[p + 3] = 255
    }
  }

  const dpr = window.devicePixelRatio || 1
  const scale = Math.max(1, Math.min(6, Math.round(displayScale)))
  const logicalW = width * scale
  const logicalH = height * scale

  canvas.width = Math.max(1, Math.round(logicalW * dpr))
  canvas.height = Math.max(1, Math.round(logicalH * dpr))
  canvas.style.width = `${logicalW}px`
  canvas.style.height = `${logicalH}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  // Draw via temp canvas at 1:1 then scale
  const tmp = document.createElement('canvas')
  tmp.width = width
  tmp.height = height
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(out, 0, 0)
  ctx.clearRect(0, 0, logicalW, logicalH)
  ctx.drawImage(tmp, 0, 0, logicalW, logicalH)
}
