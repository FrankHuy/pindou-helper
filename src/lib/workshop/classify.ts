import { closestColorWithDistance } from '../color-match'
import type { BeadColor } from '../palette'
import { EMPTY_DISTANCE_THRESHOLD, isLightBackground } from './empty'

export type CellClassification = {
  type: 'background' | 'matched' | 'uncertain'
  color?: BeadColor
  distance: number
}

/**
 * Classify a cell RGB as background, matched, or uncertain.
 * - background: light/white → empty cell (same as isLightBackground)
 * - matched: not background + distance ≤ threshold → nearest palette color
 * - uncertain: not background + distance > threshold → user decides
 */
export function classifyCell(
  r: number,
  g: number,
  b: number,
  palette: BeadColor[],
  distanceThreshold = EMPTY_DISTANCE_THRESHOLD,
): CellClassification {
  if (palette.length === 0) {
    return { type: 'uncertain', distance: Infinity }
  }

  if (isLightBackground(r, g, b)) {
    return { type: 'background', distance: 0 }
  }

  const { color, distance } = closestColorWithDistance([r, g, b], palette)
  if (distance > distanceThreshold) {
    return { type: 'uncertain', distance }
  }
  return { type: 'matched', color, distance }
}
