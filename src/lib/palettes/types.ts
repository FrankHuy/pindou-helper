export type BeadColor = {
  brand: string
  series: string
  code: string
  name: string
  hex: string
  rgb: [number, number, number]
}

/** Color-range layers aligned with the source chart page. */
export type PaletteRange = 'full' | 'standard' | 'extended'

/** Merchant pack size; null means pack is not active. */
export type MerchantPackSize =
  | 24
  | 48
  | 72
  | 96
  | 120
  | 144
  | 168
  | 192
  | 216
  | 221
  | 264
  | null

export type PaletteSelection = {
  brand: string
  range: PaletteRange
  merchantPack: MerchantPackSize
  /** null = all series; otherwise keep only listed series */
  seriesFilter: string[] | null
  disabled: Set<string>
}

export type ResolvedPalette = {
  /** Final active colors after filters + disables */
  colors: BeadColor[]
  /** Scope size after series filter, before user disables */
  totalInScope: number
  /** Human-readable scope label */
  label: string
  /** Colors after range/pack only (before series filter + disable) */
  baseColors: BeadColor[]
  /** Colors after range/pack + series filter (includes disabled; for panel listing) */
  scopedColors: BeadColor[]
}
