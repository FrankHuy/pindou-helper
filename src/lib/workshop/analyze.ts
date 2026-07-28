import { closestColor } from '../color-match'
import type { BeadColor } from '../palette'
import type { BeadPattern } from '../pattern'
import { tryBuildGridPattern, tryBuildGridPatternWithUncertain } from './grid'
import { cropRows, fileToImageData } from './image-data'
import { mineColorsFromPattern, sampleLegendColors } from './legend'
import {
  buildPixelAssignment,
  buildPixelAssignmentWithUncertain,
  expandUncertainAssignments,
} from './pixel'
import { clampSplitY, estimateSplitY } from './split'
import type {
  AnalyzeOptions,
  ClusterAssignment,
  LegendExtraction,
  RecognitionWithUncertain,
  WorkshopColor,
  WorkshopResult,
} from './types'

export { fileToImageData } from './image-data'
export { clampSplitY, estimateSplitY } from './split'
export { drawPixelPreview, drawUncertainHighlight } from './pixel'
export { clusterUncertainColors } from './cluster'
export type {
  AnalyzeOptions,
  ClusterAssignment,
  LegendExtraction,
  RecognitionWithUncertain,
  UncertainCluster,
  UncertainSample,
  WorkshopColor,
  WorkshopMode,
  WorkshopPhase,
  WorkshopPixelModel,
  WorkshopResult,
} from './types'

export type WorkshopAnalyzeOutput = WorkshopResult & {
  /** Full decoded source (caller may retain for re-split) */
  image: ImageData
  /** Pixel-mode draw source (downscaled pattern crop); grid mode may omit */
  patternPreview?: ImageData
}

// ---------------------------------------------------------------------------
// Phase 1: extract legend candidates only
// ---------------------------------------------------------------------------

/**
 * Extract legend color candidates from the image below the split line.
 * Falls back to mining from pattern region if no legend swatches found.
 */
export function extractLegendCandidates(
  image: ImageData,
  splitY: number,
  fullPalette: BeadColor[],
): LegendExtraction {
  if (image.width < 8 || image.height < 8) {
    throw new Error('图片尺寸过小，无法识别')
  }
  if (fullPalette.length === 0) {
    throw new Error('色卡为空，无法匹配色号')
  }

  const sy = clampSplitY(splitY, image.height)
  const patternRegion = cropRows(image, 0, sy)
  const legendRegion = cropRows(image, sy, image.height)

  let colors = sampleLegendColors(legendRegion, fullPalette)
  let legendFallback = false

  if (colors.length === 0) {
    colors = mineColorsFromPattern(patternRegion, fullPalette)
    legendFallback = true
  }

  return { colors, legendFallback }
}

// ---------------------------------------------------------------------------
// Phase 2: recognize pattern with confirmed palette, track uncertain cells
// ---------------------------------------------------------------------------

/**
 * Run grid → pixel recognition using the confirmed palette.
 * Collects uncertain samples (not background + distance > threshold).
 */
export function recognizePattern(
  image: ImageData,
  splitY: number,
  confirmedPalette: BeadColor[],
  legendFallback = false,
): RecognitionWithUncertain {
  if (confirmedPalette.length === 0) {
    throw new Error('色板为空，无法识别')
  }

  const sy = clampSplitY(splitY, image.height)
  const patternRegion = cropRows(image, 0, sy)

  const gridResult = tryBuildGridPatternWithUncertain(patternRegion, confirmedPalette)
  if (gridResult) {
    return {
      mode: 'grid',
      pattern: gridResult.pattern,
      uncertainSamples: gridResult.uncertainSamples,
      uncertainMask: gridResult.uncertainMask,
      splitY: sy,
      legendFallback,
      image,
    }
  }

  const pixelResult = buildPixelAssignmentWithUncertain(patternRegion, confirmedPalette)
  // Allow zero matched colors if there are uncertain samples
  if (pixelResult.colors.length === 0 && pixelResult.uncertainSamples.length === 0) {
    throw new Error('未识别到可用颜色，请调整分隔线后重试')
  }

  return {
    mode: 'pixel',
    pixel: pixelResult.pixel,
    colors: pixelResult.colors,
    patternPreview: pixelResult.preview,
    uncertainSamples: pixelResult.uncertainSamples,
    uncertainMask: pixelResult.uncertainMask,
    splitY: sy,
    legendFallback,
    image,
  }
}

// ---------------------------------------------------------------------------
// Phase 3: apply user cluster corrections → final WorkshopAnalyzeOutput
// ---------------------------------------------------------------------------

/**
 * Reassign uncertain cells/pixels per user cluster assignments.
 * Unassigned clusters (or code: null) become empty.
 *
 * @param clusters - cluster membership (indices into recognition.uncertainSamples)
 */
export function applyCorrections(
  recognition: RecognitionWithUncertain,
  assignments: ClusterAssignment[],
  clusters: { id: number; indices: number[] }[],
  confirmedPalette: BeadColor[],
): WorkshopAnalyzeOutput {
  const assignmentMap = new Map(assignments.map((a) => [a.clusterId, a.code]))
  const byCode = new Map(confirmedPalette.map((c) => [c.code, c]))

  // sample array index → assigned BeadColor | null
  const sampleAssign = new Map<number, BeadColor | null>()
  for (const cluster of clusters) {
    const code = assignmentMap.has(cluster.id) ? assignmentMap.get(cluster.id)! : null
    const bead = code != null ? (byCode.get(code) ?? null) : null
    for (const sampleIdx of cluster.indices) {
      sampleAssign.set(sampleIdx, bead)
    }
  }

  // pattern index → color (from sample index via uncertainSamples)
  const patternIndexAssign = new Map<number, BeadColor | null>()
  for (let si = 0; si < recognition.uncertainSamples.length; si++) {
    const sample = recognition.uncertainSamples[si]
    if (sampleAssign.has(si)) {
      patternIndexAssign.set(sample.index, sampleAssign.get(si)!)
    } else {
      patternIndexAssign.set(sample.index, null)
    }
  }

  if (recognition.mode === 'grid' && recognition.pattern) {
    return applyGridCorrections(recognition, patternIndexAssign, confirmedPalette)
  }

  if (recognition.mode === 'pixel' && recognition.pixel) {
    return applyPixelCorrections(recognition, patternIndexAssign, sampleAssign, confirmedPalette)
  }

  throw new Error('识别结果无效')
}

function applyGridCorrections(
  recognition: RecognitionWithUncertain,
  patternIndexAssign: Map<number, BeadColor | null>,
  confirmedPalette: BeadColor[],
): WorkshopAnalyzeOutput {
  const pattern = recognition.pattern!
  const cells = [...pattern.cells]
  const counts = new Map<string, number>()
  let emptyCount = 0

  // First, re-count existing matched cells
  for (let i = 0; i < cells.length; i++) {
    if (patternIndexAssign.has(i)) {
      // Uncertain cell — apply assignment
      const bead = patternIndexAssign.get(i)!
      cells[i] = bead
      if (bead) {
        counts.set(bead.code, (counts.get(bead.code) ?? 0) + 1)
      } else {
        emptyCount += 1
      }
    } else if (cells[i]) {
      counts.set(cells[i]!.code, (counts.get(cells[i]!.code) ?? 0) + 1)
    } else {
      emptyCount += 1
    }
  }

  const newPattern: BeadPattern = {
    width: pattern.width,
    height: pattern.height,
    cells,
    counts,
    emptyCount,
  }

  return {
    mode: 'grid',
    colors: colorsFromPattern(newPattern, confirmedPalette),
    pattern: newPattern,
    splitY: recognition.splitY,
    legendFallback: recognition.legendFallback,
    image: recognition.image,
  }
}

function applyPixelCorrections(
  recognition: RecognitionWithUncertain,
  _patternIndexAssign: Map<number, BeadColor | null>,
  sampleAssign: Map<number, BeadColor | null>,
  confirmedPalette: BeadColor[],
): WorkshopAnalyzeOutput {
  const pixel = recognition.pixel!
  const { width, height } = pixel
  const oldLabels = pixel.labels
  const labels = new Int16Array(width * height)
  const mask = recognition.uncertainMask
  const preColors = recognition.colors ?? []

  const codeToIndex = new Map<string, number>()
  const colorList: BeadColor[] = []
  const counts = new Map<string, number>()

  const ensureIndex = (bead: BeadColor): number => {
    let idx = codeToIndex.get(bead.code)
    if (idx === undefined) {
      idx = colorList.length
      codeToIndex.set(bead.code, idx)
      colorList.push(bead)
    }
    return idx
  }

  // Expand block-origin samples onto mask neighbors without overwriting other samples.
  // block=1: every uncertain pixel is an origin → no expansion.
  // block=2: fill remaining 2×2 only where mask is set and no sample owns the pixel.
  const blockAssign = expandUncertainAssignments(
    width,
    height,
    recognition.uncertainSamples,
    sampleAssign,
    mask,
  )

  for (let i = 0; i < width * height; i++) {
    if (mask && mask[i] === 1) {
      const assigned = blockAssign.has(i) ? blockAssign.get(i)! : null
      if (assigned) {
        labels[i] = ensureIndex(assigned)
        counts.set(assigned.code, (counts.get(assigned.code) ?? 0) + 1)
      } else {
        labels[i] = -1
      }
    } else if (oldLabels[i] >= 0 && preColors[oldLabels[i]]) {
      const oldColor = preColors[oldLabels[i]]
      const bead = confirmedPalette.find((c) => c.code === oldColor.code)
        ?? closestColor(oldColor.rgb, confirmedPalette)
      labels[i] = ensureIndex(bead)
      counts.set(bead.code, (counts.get(bead.code) ?? 0) + 1)
    } else {
      labels[i] = -1
    }
  }

  const colors: WorkshopColor[] = colorList
    .map((c) => ({
      code: c.code,
      hex: c.hex,
      rgb: c.rgb,
      count: counts.get(c.code) ?? 0,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.code.localeCompare(b.code, undefined, { numeric: true })
    })

  const remap = new Map<string, number>()
  colors.forEach((c, i) => remap.set(c.code, i))
  const oldCodes = colorList.map((c) => c.code)
  for (let i = 0; i < labels.length; i++) {
    const old = labels[i]
    if (old < 0) continue
    labels[i] = remap.get(oldCodes[old]) ?? -1
  }

  return {
    mode: 'pixel',
    colors,
    pixel: { width, height, labels },
    splitY: recognition.splitY,
    legendFallback: recognition.legendFallback,
    image: recognition.image,
    patternPreview: recognition.patternPreview,
  }
}

// ---------------------------------------------------------------------------
// Backward-compat: single-shot analyze (auto-confirm all, no uncertain fix)
// ---------------------------------------------------------------------------

/**
 * Full workshop analyze pipeline (backward compat):
 * split → legend colors → grid try → pixel fallback.
 * Auto-accepts all legend candidates; uncertain cells become empty.
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
  const extraction = extractLegendCandidates(image, splitY, fullPalette)

  if (extraction.colors.length === 0) {
    throw new Error('未识别到可用颜色，请调整分隔线后重试')
  }

  // Use original single-shot path for backward compat (no uncertain tracking needed)
  const patternRegion = cropRows(image, 0, splitY)
  const matchPalette = extraction.colors

  const gridPattern = tryBuildGridPattern(patternRegion, matchPalette)
  if (gridPattern) {
    return {
      mode: 'grid',
      colors: colorsFromPattern(gridPattern, matchPalette),
      pattern: gridPattern,
      splitY,
      legendFallback: extraction.legendFallback,
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
    legendFallback: extraction.legendFallback,
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
