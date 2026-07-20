import type { BeadColor } from '../palette'
import type { BeadPattern } from '../pattern'
import { tryBuildGridPattern } from './grid'
import { cropRows, fileToImageData } from './image-data'
import { mineColorsFromPattern, sampleLegendColors } from './legend'
import { buildPixelAssignment } from './pixel'
import { clampSplitY, estimateSplitY } from './split'
import type { AnalyzeOptions, WorkshopColor, WorkshopResult } from './types'

export { fileToImageData } from './image-data'
export { clampSplitY, estimateSplitY } from './split'
export { drawPixelPreview } from './pixel'
export type {
  AnalyzeOptions,
  WorkshopColor,
  WorkshopMode,
  WorkshopPixelModel,
  WorkshopResult,
} from './types'

export type WorkshopAnalyzeOutput = WorkshopResult & {
  /** Full decoded source (caller may retain for re-split) */
  image: ImageData
  /** Pixel-mode draw source (downscaled pattern crop); grid mode may omit */
  patternPreview?: ImageData
}

/**
 * Full workshop analyze pipeline:
 * split → legend colors → grid try → pixel fallback.
 */
export function analyzeWorkshopImageData(
  image: ImageData,
  options: AnalyzeOptions,
): WorkshopAnalyzeOutput {
  const { fullPalette } = options

  if (image.width < 8 || image.height < 8) {
    throw new Error('图片尺寸过小，无法识别')
  }
  if (fullPalette.length === 0) {
    throw new Error('色卡为空，无法匹配色号')
  }

  const splitY = clampSplitY(options.splitY ?? estimateSplitY(image), image.height)

  const patternRegion = cropRows(image, 0, splitY)
  const legendRegion = cropRows(image, splitY, image.height)

  let legendColors = sampleLegendColors(legendRegion, fullPalette)
  let legendFallback = false

  if (legendColors.length === 0) {
    legendColors = mineColorsFromPattern(patternRegion, fullPalette)
    legendFallback = true
  }

  if (legendColors.length === 0) {
    throw new Error('未识别到可用颜色，请调整分隔线后重试')
  }

  const matchPalette = legendColors

  const gridPattern = tryBuildGridPattern(patternRegion, matchPalette)
  if (gridPattern) {
    return {
      mode: 'grid',
      colors: colorsFromPattern(gridPattern, matchPalette),
      pattern: gridPattern,
      splitY,
      legendFallback,
      image,
    }
  }

  const pixelResult = buildPixelAssignment(patternRegion, matchPalette)
  if (pixelResult.colors.length === 0) {
    throw new Error('未识别到可用颜色，请调整分隔线后重试')
  }

  return {
    mode: 'pixel',
    colors: pixelResult.colors,
    pixel: pixelResult.pixel,
    splitY,
    legendFallback,
    image,
    patternPreview: pixelResult.preview,
  }
}

/** Decode file then analyze (auto or explicit split). */
export async function analyzeWorkshopFile(
  file: File,
  fullPalette: BeadColor[],
  splitY?: number,
): Promise<WorkshopAnalyzeOutput> {
  const image = await fileToImageData(file)
  return analyzeWorkshopImageData(image, { fullPalette, splitY })
}

function colorsFromPattern(pattern: BeadPattern, palette: BeadColor[]): WorkshopColor[] {
  const byCode = new Map(palette.map((c) => [c.code, c]))
  const list: WorkshopColor[] = []

  for (const [code, count] of pattern.counts) {
    if (count <= 0) continue
    const bead = byCode.get(code)
    if (!bead) continue
    list.push({
      code: bead.code,
      hex: bead.hex,
      rgb: bead.rgb,
      count,
    })
  }

  list.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.code.localeCompare(b.code, undefined, { numeric: true })
  })
  return list
}
