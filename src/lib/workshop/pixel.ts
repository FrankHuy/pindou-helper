import type { BeadColor } from '../palette'
import { mapRgbToBead } from './empty'
import { downscaleImageData } from './image-data'
import type { WorkshopColor, WorkshopPixelModel } from './types'

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
