# Technical Design — PNG legend + highlight

## Overview

Extend drawing/export in `src/lib/pattern.ts` and wire highlight + split disable control in `src/App.tsx` / `App.css`. No new dependencies.

## Contracts

### `DrawOptions` (extend)

```ts
export type DrawOptions = {
  cellSize: number
  showGrid: boolean
  showCodes: boolean
  background?: string
  /** Preview only: focus one code; null = no highlight */
  highlightCode?: string | null
}
```

`drawPattern`:

- When `highlightCode` is null/undefined: current behavior (full opacity).
- When set: for each cell, if `bead.code !== highlightCode`, draw fill (and code text) at reduced alpha (~0.35–0.4); if match, full opacity + 1px contrast stroke after fill.
- Grid lines remain subtle; prefer drawing grid after fills so structure stays visible.

### Legend (export only)

```ts
function buildUsageLegend(pattern: BeadPattern): { code: string; count: number; hex: string; rgb: ... }[]
// sort counts desc, then code; resolve hex from first cell with that code or counts keys + cell lookup
```

`exportPattern(pattern, showCodes)`:

1. Compute legend entries from `pattern.counts` (count > 0 only).
2. Measure legend block height for canvas width = `pattern.width * cellSize` (padding, title line, chip wrap).
3. Create canvas with height = pattern area + gap + legend height.
4. `drawPattern` into top region **without** `highlightCode`.
5. Draw legend into bottom: title + summary, then chips (swatch + `code:count`).
6. `toBlob` download as today.

Prefer implementing legend layout as pure functions:

- `layoutLegend(entries, width, styles) -> { height, rows }`
- `drawLegend(ctx, layout, originY)`

so preview path never pays for legend unless we later opt in (out of scope).

### App state

```ts
const [highlightCode, setHighlightCode] = useState<string | null>(null)
```

- `drawPattern(..., { ..., highlightCode })` in existing `useEffect` deps.
- Color row: main button/area `onClick` → toggle highlight if `count > 0 && !disabled`.
- Trailing icon button: `onClick` (stopPropagation) → `toggleDisabled(code)`; if disabling current highlight, clear it.
- `useEffect`: if `highlightCode` set but not in `pattern.counts` with count>0 or is disabled → `setHighlightCode(null)`.
- Visual: `.color-row.highlighted` for active focus; disabled icon with `aria-label`.

## Data flow

```
pattern.counts ──► colorUsage list (UI)
                 └► export legend (PNG bottom)

highlightCode ──► drawPattern (preview only)
              ╳── exportPattern (never)
```

## Compatibility

| Item | Strategy |
|------|----------|
| `exportPattern` signature | keep `(pattern, showCodes)` or add optional 3rd options bag only if needed; default always includes legend |
| Existing disable | move off full-row click to icon |
| PNG size | taller when many colors; width unchanged |

## Risks

1. **Many colors (100+)** → tall PNG: acceptable; wrap + readable font min size.
2. **DPR / offscreen canvas**: export already uses detached canvas; legend measurement must use same ctx scale as export (devicePixelRatio handling consistent with current export — today export uses CSS pixels then blob; keep same model).
3. **Touch targets**: icon button min ~32px hit area.

## Out of design scope

PDF, multi-select highlight, craft mode.
