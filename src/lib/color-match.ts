import type { BeadColor } from './palette'

/** Weighted RGB distance (same metric as pattern matching). */
export function colorDistance(rgb: [number, number, number], candidate: BeadColor): number {
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

/** Nearest palette color by {@link colorDistance}. Assumes palette is non-empty. */
export function closestColor(rgb: [number, number, number], palette: BeadColor[]): BeadColor {
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

/** Nearest color with distance; for empty / far-from-palette heuristics. */
export function closestColorWithDistance(
  rgb: [number, number, number],
  palette: BeadColor[],
): { color: BeadColor; distance: number } {
  let closest = palette[0]
  let closestDistance = Number.POSITIVE_INFINITY

  for (const candidate of palette) {
    const distance = colorDistance(rgb, candidate)
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }

  return { color: closest, distance: closestDistance }
}
