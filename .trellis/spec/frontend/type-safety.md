# Type Safety

> Type safety patterns in this project.

---

## Overview

TypeScript project built with `tsc -b` + Vite. Domain types are explicit; **no** runtime schema library (zod/io-ts). Worker and SPA share conceptual contracts via documented JSON shapes (see `xhs-download.md`), not a shared package.

---

## Type Organization

| Type | Home | Notes |
|------|------|-------|
| `BeadColor` | `src/lib/palettes/types.ts` | Also re-exported via `src/lib/palette.ts` |
| `PaletteRange`, `MerchantPackSize`, `PaletteSelection`, `ResolvedPalette` | `palettes/types.ts` | Selection is UI → resolve input |
| `PatternOptions`, `BeadPattern`, `PatternCell`, `DrawOptions`, `LegendEntry` | `src/lib/pattern.ts` | Generate + draw/export |
| `ImageAdjustments` | `src/lib/presets.ts` | Shared by presets + pattern |
| `colorDistance` / `closestColor` / `closestColorWithDistance` | `src/lib/color-match.ts` | Single metric for pattern + workshop |
| `WorkshopResult`, `WorkshopColor`, `WorkshopMode`, `AnalyzeOptions` | `src/lib/workshop/types.ts` | Import-sheet analyze |
| `WorkshopAnalyzeOutput` | `src/lib/workshop/analyze.ts` | Result + optional UI hint fields |
| `Env` (Worker) | `worker/index.ts` | `ASSETS`, Turnstile secrets/keys |
| XHS client types | `src/features/xhs/xhsApi.ts` | Parse result, errors as `Error` messages |
| Shell unions | `src/App.tsx` | `AppTab`, `ShellPage` (local, not exported package API) |

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
type PatternCell = BeadColor | null  // null = empty / no bead

type BackgroundRemoveOptions = {
  enabled: boolean
  sampleRgb: [number, number, number] | null
  tolerance: number  // 0–100 UI scale
}

type PatternOptions = {
  targetWidth: number
  palette: BeadColor[]
  maxColors?: number      // 0 / undefined = unlimited
  adjustments?: ImageAdjustments
  backgroundRemove?: BackgroundRemoveOptions
  alphaThreshold?: number // default 16; alpha below → empty
}

type BeadPattern = {
  width: number
  height: number
  cells: PatternCell[]
  counts: Map<string, number>  // non-null beads only
  emptyCount: number
}
```

Pipeline:

1. Decode → canvas scale → `getImageData`
2. Build empty mask on **pre-adjust** pixels: `alpha < alphaThreshold` always; optional color-key when `backgroundRemove.enabled && sampleRgb` (max channel delta ≤ `tolerance * 2.55`)
3. `applyAdjustments` on RGB (preserve alpha)
4. Quantize / match **only non-empty** pixels via `closestColor` from `color-match.ts`
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

- `HIGHLIGHT_DIM_ALPHA` exported from `pattern.ts` for shared dimming (workshop pixel path).
- `highlightCode` dims non-matching cells; **export must pass null/omit**.
- `exportPattern` always appends legend from `pattern.counts` (「用色统计」).

### Workshop analyze

```ts
analyzeWorkshopImageData(image: ImageData, options: AnalyzeOptions): WorkshopAnalyzeOutput
analyzeWorkshopFile(file: File, fullPalette: BeadColor[], splitY?: number): Promise<WorkshopAnalyzeOutput>
```

- `WorkshopResult.mode`: `'grid' | 'pixel'`
- Grid: optional `pattern: BeadPattern`
- Pixel: `pixel.labels` Int16Array (`-1` = empty, else index into `colors`)
- `legendFallback: true` when colors mined from pattern region only

### Worker `Env` + public config

```ts
// GET /api/config → { turnstileSiteKey: string | null, turnstileRequired: boolean }
// Secrets never in JSON: TURNSTILE_SECRET only on Worker
```

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

### Don't: Fork RGB distance

```ts
// Wrong — second metric in workshop
function myDistance(a, b) { … }

// Correct
import { closestColor, colorDistance } from '../color-match'
```

### Don't: Trust untyped `import.meta.env` alone for production Turnstile

Prefer Worker `/api/config` so Cloudflare Git deploys work without baking `VITE_*` at SPA build time; build env remains optional fallback.

---

## Common Patterns

- `Set<string>` for disabled codes and pack membership
- `rgb: [number, number, number]` tuples, not objects
- Prefer `import type` for type-only imports
- Feature-local unions (`Phase`, `AppTab`) over premature shared enums
