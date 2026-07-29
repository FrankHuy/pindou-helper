import type { BeadPattern } from '../pattern'
import type { WorkshopAnalyzeOutput, WorkshopColor } from './analyze'

/**
 * Convert a generated BeadPattern into a final workshop result.
 * Skips legend extract / grid-pixel re-recognition (self-authored pattern).
 */
export function workshopResultFromGeneratedPattern(
  pattern: BeadPattern,
): WorkshopAnalyzeOutput {
  const cells = pattern.cells.slice()
  const counts = new Map(pattern.counts)
  const hexByCode = new Map<string, { hex: string; rgb: [number, number, number] }>()

  for (const cell of cells) {
    if (cell == null) continue
    if (!hexByCode.has(cell.code)) {
      hexByCode.set(cell.code, { hex: cell.hex, rgb: cell.rgb })
    }
  }

  const colors: WorkshopColor[] = []
  for (const [code, count] of counts) {
    if (count <= 0) continue
    const meta = hexByCode.get(code)
    if (!meta) continue
    colors.push({
      code,
      hex: meta.hex,
      rgb: meta.rgb,
      count,
    })
  }

  colors.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.code.localeCompare(b.code, undefined, { numeric: true })
  })

  // Placeholder source: grid draw uses pattern only; split / re-extract need a real upload.
  const image = new ImageData(1, 1)

  return {
    mode: 'grid',
    colors,
    pattern: {
      width: pattern.width,
      height: pattern.height,
      cells,
      counts,
      emptyCount: pattern.emptyCount,
    },
    splitY: 0,
    legendFallback: false,
    image,
  }
}
