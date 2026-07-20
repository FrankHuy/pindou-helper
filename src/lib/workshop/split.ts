import { downscaleImageData } from './image-data'

/**
 * Estimate the Y where the legend starts (pattern occupies y < splitY).
 * Heuristic: look for a wide low-variance / near-white horizontal band
 * between dense upper content and lower chip-like content.
 */
export function estimateSplitY(imageData: ImageData): number {
  const h = imageData.height
  if (h < 20) return Math.floor(h * 0.78)

  const work = downscaleImageData(imageData, 480)
  const scaleY = h / work.height
  const scores = rowScores(work)

  const minPattern = Math.floor(work.height * 0.4)
  const maxPattern = Math.floor(work.height * 0.92)
  const searchStart = Math.max(minPattern, Math.floor(work.height * 0.45))
  const searchEnd = Math.min(maxPattern, Math.floor(work.height * 0.9))

  let bestY = Math.floor(work.height * 0.78)
  let bestScore = -Infinity

  for (let y = searchStart; y <= searchEnd; y += 1) {
    // Prefer near-white, low-variance rows as separator candidates
    const local = averageWindow(scores, y, 2)
    // Pattern above should be denser (higher activity); legend below has mid activity
    const above = averageWindow(scores, Math.max(0, y - Math.floor(work.height * 0.12)), 4)
    const below = averageWindow(scores, Math.min(work.height - 1, y + Math.floor(work.height * 0.08)), 4)

    // Separator: low activity + bright
    const sepBonus = (1 - local.activity) * 1.4 + local.brightness * 0.8
    // Prefer transition: more activity above than at separator
    const transition = Math.max(0, above.activity - local.activity)
    // Legend region should still have some non-white content (swatches)
    const legendContent = below.activity > 0.04 ? 0.3 : -0.4

    const score = sepBonus + transition * 2 + legendContent
    if (score > bestScore) {
      bestScore = score
      bestY = y
    }
  }

  // Fallback band if confidence is weak: bottom ~22%
  if (bestScore < 1.2) {
    bestY = Math.floor(work.height * 0.78)
  }

  let splitY = Math.round(bestY * scaleY)
  return clampSplitY(splitY, h)
}

/**
 * Clamp split Y so both pattern (y < split) and legend (y >= split) keep at least
 * a few pixels. No large percentage floor — users may place the handle anywhere.
 */
export function clampSplitY(splitY: number, imageHeight: number): number {
  if (imageHeight <= 2) return Math.max(0, Math.min(imageHeight, Math.round(splitY)))
  const minY = 1
  const maxY = imageHeight - 1
  return Math.max(minY, Math.min(maxY, Math.round(splitY)))
}

type RowScore = { activity: number; brightness: number }

function rowScores(image: ImageData): RowScore[] {
  const { width, height, data } = image
  const scores: RowScore[] = []

  for (let y = 0; y < height; y += 1) {
    let sum = 0
    let sumSq = 0
    let bright = 0
    let edge = 0
    const rowOff = y * width * 4

    for (let x = 0; x < width; x += 1) {
      const i = rowOff + x * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      sum += lum
      sumSq += lum * lum
      bright += lum
      if (x > 0) {
        const pi = rowOff + (x - 1) * 4
        const pl = 0.299 * data[pi] + 0.587 * data[pi + 1] + 0.114 * data[pi + 2]
        edge += Math.abs(lum - pl)
      }
    }

    const n = width
    const mean = sum / n
    const variance = Math.max(0, sumSq / n - mean * mean)
    const activity = Math.min(1, Math.sqrt(variance) / 64 + edge / (n * 40))
    const brightness = bright / (n * 255)
    scores.push({ activity, brightness })
  }

  return scores
}

function averageWindow(scores: RowScore[], center: number, radius: number): RowScore {
  let activity = 0
  let brightness = 0
  let count = 0
  const start = Math.max(0, center - radius)
  const end = Math.min(scores.length - 1, center + radius)
  for (let i = start; i <= end; i += 1) {
    activity += scores[i].activity
    brightness += scores[i].brightness
    count += 1
  }
  if (count === 0) return { activity: 0, brightness: 1 }
  return { activity: activity / count, brightness: brightness / count }
}
