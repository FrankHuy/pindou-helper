import type { BeadPattern } from '../pattern'

export type WorkshopMode = 'grid' | 'pixel'

export type WorkshopColor = {
  code: string
  hex: string
  rgb: [number, number, number]
  count: number
}

export type WorkshopPixelModel = {
  width: number
  height: number
  /** -1 empty; else index into colors[] */
  labels: Int16Array
}

export type WorkshopResult = {
  mode: WorkshopMode
  colors: WorkshopColor[]
  /** grid only */
  pattern?: BeadPattern
  /** pixel only */
  pixel?: WorkshopPixelModel
  /** Pixel Y in full image where legend starts (pattern is y < splitY) */
  splitY: number
  /** True when legend swatches were missing and colors came from pattern mining */
  legendFallback: boolean
}

export type AnalyzeOptions = {
  /** Full-image split Y in source pixels; if omitted, auto-estimate */
  splitY?: number
  /** Full MARD (or active) palette for nearest-code match */
  fullPalette: import('../palette').BeadColor[]
}

// --- Three-phase workshop types ---

export type UncertainSample = {
  rgb: [number, number, number]
  /** Flat index into grid cells (mode grid) or pixel array (mode pixel) */
  index: number
}

export type UncertainCluster = {
  id: number
  representative: [number, number, number]
  count: number
  indices: number[]
}

export type ClusterAssignment = {
  clusterId: number
  /** Assigned bead code, or null for empty */
  code: string | null
}

export type LegendExtraction = {
  colors: import('../palette').BeadColor[]
  legendFallback: boolean
}

export type RecognitionWithUncertain = {
  mode: WorkshopMode
  pattern?: BeadPattern
  pixel?: WorkshopPixelModel
  /** Matched colors before uncertain correction (pixel mode) */
  colors?: WorkshopColor[]
  uncertainSamples: UncertainSample[]
  /** 1 = uncertain, 0 = matched/background (grid: cells, pixel: pixels) */
  uncertainMask?: Uint8Array
  patternPreview?: ImageData
  splitY: number
  legendFallback: boolean
  image: ImageData
}

export type WorkshopPhase =
  | 'idle'
  | 'palette'
  | 'recognizing'
  | 'uncertain'
  | 'done'
