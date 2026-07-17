import { EXTENDED_SERIES, MARD_COLORS, STANDARD_SERIES } from './mard-colors'
import { MARD_PACKS } from './mard-packs'
import type { BeadColor, PaletteSelection, ResolvedPalette } from './types'

const STANDARD_SET = new Set<string>(STANDARD_SERIES)
const EXTENDED_SET = new Set<string>(EXTENDED_SERIES)

function colorsByRange(range: PaletteSelection['range']): BeadColor[] {
  if (range === 'full') return MARD_COLORS
  if (range === 'standard') return MARD_COLORS.filter((color) => STANDARD_SET.has(color.series))
  return MARD_COLORS.filter((color) => EXTENDED_SET.has(color.series))
}

function rangeLabel(range: PaletteSelection['range'], count: number): string {
  if (range === 'full') return `完整色号库 ${count}`
  if (range === 'standard') return `标准系列 ${count}`
  return `扩展系列 ${count}`
}

/**
 * Resolve the active bead palette from layered selection:
 * merchant pack overrides range → series filter → disabled codes.
 */
export function resolvePalette(selection: PaletteSelection): ResolvedPalette {
  let base: BeadColor[]
  let label: string

  if (selection.merchantPack != null) {
    const packCodes = MARD_PACKS[String(selection.merchantPack)]
    const codeSet = new Set(packCodes ?? [])
    base = MARD_COLORS.filter((color) => codeSet.has(color.code))
    label = `商家套装 ${selection.merchantPack}`
  } else {
    base = colorsByRange(selection.range)
    label = rangeLabel(selection.range, base.length)
  }

  const scopedColors =
    selection.seriesFilter == null
      ? base
      : base.filter((color) => selection.seriesFilter!.includes(color.series))

  const totalInScope = scopedColors.length
  const colors = scopedColors.filter((color) => !selection.disabled.has(color.code))

  return { colors, totalInScope, label, baseColors: base, scopedColors }
}
