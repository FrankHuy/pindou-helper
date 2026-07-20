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
