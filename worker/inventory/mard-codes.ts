/** Compact server-side MARD catalog bounds. Keep in sync with src/lib/palettes/mard-colors.ts. */
const MARD_MAX_SUFFIX_BY_SERIES = {
  A: 26,
  B: 32,
  C: 29,
  D: 26,
  E: 24,
  F: 25,
  G: 21,
  H: 23,
  M: 15,
  P: 23,
  Q: 5,
  R: 28,
  T: 1,
  Y: 5,
  ZG: 8,
} as const

export const MARD_CODE_COUNT = Object.values(MARD_MAX_SUFFIX_BY_SERIES).reduce(
  (total, maximum) => total + maximum,
  0,
)

export function normalizeMardCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(code)
  if (!match) return null

  const series = match[1] as keyof typeof MARD_MAX_SUFFIX_BY_SERIES
  const maximum = MARD_MAX_SUFFIX_BY_SERIES[series]
  if (!maximum) return null

  const suffix = Number(match[2])
  return Number.isSafeInteger(suffix) && suffix <= maximum ? code : null
}
