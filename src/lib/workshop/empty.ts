import { closestColorWithDistance } from '../color-match'
import type { BeadColor } from '../palette'

/** Max weighted distance to nearest palette color before treating as empty. */
export const EMPTY_DISTANCE_THRESHOLD = 95

/** Near-white / light gray background → empty cell (rule A). */
export function isLightBackground(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  // High value + low saturation (paper / export bg / EMPTY_CELL_FILL)
  if (max >= 232 && sat <= 0.12) return true
  if (max >= 220 && sat <= 0.06 && (r + g + b) / 3 >= 225) return true
  // Soft empty fill used by drawPattern (~#f0f2ef)
  if (r >= 230 && g >= 232 && b >= 228 && sat <= 0.08) return true
  return false
}

/**
 * Map RGB → BeadColor or null using empty heuristics + restricted palette.
 * Prefer legend-derived palette when non-empty.
 */
export function mapRgbToBead(
  r: number,
  g: number,
  b: number,
  palette: BeadColor[],
  distanceThreshold = EMPTY_DISTANCE_THRESHOLD,
): BeadColor | null {
  if (palette.length === 0) return null
  if (isLightBackground(r, g, b)) return null

  const { color, distance } = closestColorWithDistance([r, g, b], palette)
  if (distance > distanceThreshold) return null
  return color
}
