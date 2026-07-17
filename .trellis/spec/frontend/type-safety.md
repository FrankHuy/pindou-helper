# Type Safety

> Type safety patterns in this project.

---

## Overview

TypeScript strict project (`tsc -b`). Domain types are explicit; no runtime schema library yet.

---

## Type Organization

| Type | Home | Notes |
|------|------|-------|
| `BeadColor` | `src/lib/palettes/types.ts` | Also re-exported via `src/lib/palette.ts` |
| `PaletteRange`, `MerchantPackSize`, `PaletteSelection`, `ResolvedPalette` | `palettes/types.ts` | Selection is UI → resolve input |
| `PatternOptions`, `BeadPattern`, `PatternCell` | `src/lib/pattern.ts` | Pipeline contract |
| `DrawOptions`, `LegendEntry` | `src/lib/pattern.ts` | Preview draw + export legend |
| `ImageAdjustments` | `src/lib/presets.ts` | Shared by presets + pattern |

`BeadColor` required fields: `brand`, `series`, `code`, `name`, `hex`, `rgb`.  
`name` may equal `code` when Chinese names are unavailable.

---

## Contracts

### `resolvePalette(selection: PaletteSelection): ResolvedPalette`

Layer order (must not be reordered):

1. **Merchant pack** if `merchantPack != null` → exact code list (overrides range)
2. Else **range**: `full` | `standard` | `extended`
3. **seriesFilter** if non-null → keep only listed series
4. **disabled** → drop codes for final `colors`

Return fields:

- `colors` — final active palette for matching
- `totalInScope` — after series filter, before disable
- `label` — UI scope string
- `baseColors` / `scopedColors` — for series chips and panel listing

### `createPattern(file: File, options: PatternOptions): Promise<BeadPattern>`

```ts
type PatternOptions = {
  targetWidth: number
  palette: BeadColor[]
  maxColors?: number      // 0 / undefined = unlimited
  adjustments?: ImageAdjustments
}
```

Pipeline:

1. Decode → canvas scale → `getImageData`
2. `applyAdjustments` (brightness → contrast → saturation)
3. If `maxColors > 0 && maxColors < palette.length`: median-cut → map reps to palette
4. Else: per-pixel `closestColor(palette)`
5. Empty `palette` → throw `请至少启用一种颜色`

### `drawPattern` / `exportPattern`

```ts
type DrawOptions = {
  cellSize: number
  showGrid: boolean
  showCodes: boolean
  background?: string
  highlightCode?: string | null  // preview only
}
```

- `highlightCode` dims non-matching cells and strokes the focus color; **export must pass null/omit**.
- `exportPattern` always appends a bottom legend from `pattern.counts` (swatch + `code:count`, count desc) with title「用色统计」.

---

## Forbidden Patterns

### Don't: Approximate merchant packs with `slice`

```ts
// Wrong — packs are not contiguous prefixes of the full chart
colors.slice(0, 96)

// Correct — exact code membership
MARD_COLORS.filter((c) => packCodeSet.has(c.code))
```

### Don't: Keep the old 33-color MVP table

Old codes (e.g. A1 white `#F7F7F2`) conflict with real MARD (A1 `#FAF4C8`). Full replace only.

---

## Common Patterns

- `Set<string>` for disabled codes and pack membership
- `rgb: [number, number, number]` tuples, not objects
- Prefer `import type` for type-only imports
