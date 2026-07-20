# Technical Design — 拼豆工作间

## Overview

Add a third app tab **拼豆工作间** that ingests an existing bead pattern image (pattern on top + color legend below), recovers used MARD colors from legend swatches (no OCR), and lets the user highlight one color at a time.

Pipeline preference:

1. **Grid reconstruction** → `BeadPattern` + `drawPattern` preview (clean cells, exact counts when confident)  
2. Else **pixel mask** on the pattern region of the source image (dim non-focus pixels)

All processing is local Canvas / ImageData. No Worker API, no upload, no new runtime deps.

## Architecture

```
[App.tsx shell]
  AppTab = 'bead' | 'workshop' | 'xhs'
  bead section: keep mounted + is-hidden (existing)
  workshop section: keep mounted + is-hidden (same pattern)
  xhs: existing mount-on-tab or keep as today

[BeadWorkshopTab]  src/features/workshop/
  upload → object URL / ImageBitmap
  splitY (0–1 or px) auto + drag handle
  on split settle → analyze()
  color buttons → highlightCode
  canvas / layered preview

[lib workshop / import]  pure TS
  estimateSplitY(imageData)
  sampleLegendColors(legendRegion) → BeadColor[]
  tryBuildGridPattern(patternRegion, palette) → BeadPattern | null
  buildPixelAssignment(patternRegion, palette) → PixelWorkshopModel
  mapRgb → closest in restricted palette; empty heuristics
```

## Data model

```ts
type WorkshopMode = 'grid' | 'pixel'

type WorkshopColor = {
  code: string
  hex: string
  rgb: [number, number, number]
  count: number // grid: cell count; pixel: pixel count or 0 if omitted
}

type WorkshopResult = {
  mode: WorkshopMode
  colors: WorkshopColor[]
  /** grid only */
  pattern?: BeadPattern
  /** pixel only: width/height of pattern crop + Int16/code index map or Uint32 codes */
  pixel?: {
    width: number
    height: number
    /** -1 empty; else index into colors[] */
    labels: Int16Array
  }
  splitY: number // pixel Y in full image where legend starts (pattern is y < splitY)
}
```

`highlightCode: string | null` stays in UI state (same toggle semantics as bead tab).

## Split line

### Auto estimate

Heuristic on full image (or downscaled copy for speed):

- Prefer large horizontal low-variance / near-white band between dense upper content and lower chip-like content  
- Fallback: assume legend occupies bottom ~18–28% (tune against `exportPattern` gap + legend height)  
- Clamp so pattern height ≥ 40% and legend ≥ 8% of image

### User control

- Overlay horizontal handle on the **source image** (or a small “分界预览” strip)  
- Drag updates `splitY`; `pointerup` / 「重新识别」 debounced re-run analyze  
- Do not re-analyze every pointermove (costly); live line only while dragging

## Legend → colors (no OCR)

On region `y >= splitY`:

1. Optional downscale  
2. Find compact saturated / non-background blobs **or** scan for square-ish swatches (this tool’s legend uses 12×12-ish fills)  
3. For each swatch, median RGB → `closestColor` against **full MARD** (or standard+extended)  
4. Dedupe by `code`; sort by code or by frequency in pattern after step 2  

If zero swatches found: fall back to **unique colors quantized from pattern region only** (still nearest MARD), and surface 中文提示「未识别到图例色块，已按图案区估色」.

## Pattern assignment

Shared empty rule (A):

- Near white / light gray (max channel high + low saturation) → empty  
- Else nearest color in **legend-derived palette** (if non-empty) else full MARD  
- If distance to nearest palette color > threshold → empty (avoid inventing junk codes)

### Grid path (preferred)

1. In pattern crop, detect dominant cell size via horizontal/vertical edge projection or autocorrelation of grid lines  
2. Estimate origin (phase) and integer width/height in cells  
3. Confidence gates (examples): cell size in [4, 80] px; reconstructed dims in [8, 200]; ≥70% cells map stably  
4. Sample each cell center (or median of inner 50%) → empty / BeadColor  
5. Build `BeadPattern` + `counts`  
6. Preview: `drawPattern(canvas, pattern, { cellSize: zoom, showGrid, showCodes: false, highlightCode })`  
7. If gates fail → pixel path  

**Own-tool boost:** when image matches export traits (white legend bg, separator, regular cells), grid success rate should be high; optional later: detect filename / aspect — not required.

### Pixel path (fallback)

1. Work on pattern crop ImageData (maybe max width 800 for perf)  
2. Per pixel (or 2×2 blocks): empty or label index  
3. Preview: draw source pattern crop; second pass set `globalAlpha` for non-focus labels; focus full alpha  
4. Counts: optional pixel counts per code (UI may show count or hide if noisy)

## Color matching helpers

`colorDistance` / `closestColor` today are private in `pattern.ts`.

**Choice:** extract to `src/lib/color-match.ts` (or export from pattern) so workshop + pattern share one metric — avoids dual thresholds.

Do **not** change median-cut / createPattern behavior beyond extraction.

## UI layout (`BeadWorkshopTab`)

```
[上传图纸]
[源图 + 水平分隔手柄]     // always available for correction
[模式: 格点识别 | 像素模式]
[预览 canvas]  zoom slider optional
[色号按钮网格]  swatch + code + count?
屏幕色仅供参考
```

- Chinese copy consistent with app  
- Mobile: color chips wrap / horizontal scroll; preview max-width 100%  
- Errors: `无法读取图片` / `未识别到可用颜色，请调整分隔线后重试`

## App shell integration

```ts
type AppTab = 'bead' | 'workshop' | 'xhs'
```

- Third tab button between bead and xhs (or after bead): **拼豆工作间**  
- Header subtitle when workshop: e.g. `按色高亮已有图纸`  
- Upload control: **workshop has its own upload** (do not overload bead header upload)  
- Mount strategy: workshop section `is-hidden` when inactive so result + highlight survive tab switches  

Privacy/About shell unchanged.

## File layout

```
src/features/workshop/
  BeadWorkshopTab.tsx
  workshop.css
src/lib/
  color-match.ts          # extracted distance + closestColor
  workshop/
    analyze.ts            # orchestrate split / legend / grid|pixel
    split.ts
    legend.ts
    grid.ts
    pixel.ts
    types.ts
```

Optional: keep algorithms under `src/lib/workshop/*` only; UI never imports Worker.

## Performance

- Analyze on request / split settle, not continuous  
- Downscale for detection; full-res optional for final grid sample  
- Pixel path: cap dimension; use OffscreenCanvas if available (optional, not required)  

## Privacy / quality

- No network for workshop images  
- No OCR libs  
- Disclaimer 屏幕色仅供参考 on color list  
- Highlight preview only; no requirement to re-export from workshop in MVP  

## Compatibility / rollback

- Remove tab + `features/workshop` + `lib/workshop`; restore `AppTab`  
- `color-match` extraction can remain as pure refactor  

## Trade-offs

| Choice | Why |
|--------|-----|
| Grid then pixel | Own exports clean; third-party still usable |
| No OCR | Size, stability, offline; codes are MARD-matched |
| User split handle | Product-accepted fix for bad auto split |
| Rebuild canvas when grid OK | Best highlight UX (decision A) |
| Extract color-match | Single distance definition |

## Risks

| Risk | Mitigation |
|------|------------|
| Grid false positive (skewed cells) | Strict confidence gates → pixel fallback |
| Legend swatches missed | Pattern-only color mining + user message |
| Near-white beads removed | Tunable empty threshold; prefer legend palette distance |
| Large images jank | Downscale + debounce analyze |
