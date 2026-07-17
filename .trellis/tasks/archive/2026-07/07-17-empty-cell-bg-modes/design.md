# Technical Design — empty cells, bg remove, modes

## Overview

Extend pattern pipeline for `null` cells and background removal; add processing mode defaults in App. No new runtime deps.

## Type changes

```ts
export type PatternCell = BeadColor | null

export type BeadPattern = {
  width: number
  height: number
  cells: PatternCell[]
  counts: Map<string, number>  // only non-null beads
  emptyCount: number           // number of null cells
}

export type BackgroundRemoveOptions = {
  enabled: boolean
  /** Sample from original image; null = not sampled yet */
  sampleRgb: [number, number, number] | null
  /** 0–100 UI scale */
  tolerance: number
}

export type PatternOptions = {
  targetWidth: number
  palette: BeadColor[]
  maxColors?: number
  adjustments?: ImageAdjustments
  backgroundRemove?: BackgroundRemoveOptions
  /** alpha below this → empty; default 16 */
  alphaThreshold?: number
}
```

## Pipeline (`createPattern`)

1. Decode → scale canvas → `getImageData`
2. `applyAdjustments` on RGB (skip or light-touch alpha channel; keep alpha)
3. For each pixel:
   - if `a < alphaThreshold` → mark empty candidate
   - else if bg remove enabled && sampleRgb && color within tolerance → empty
   - else → keep RGB for matching
4. Quantize / match **only non-empty** pixels:
   - median-cut on non-empty RGBs when maxColors limits
   - empty → `cells[i] = null`
   - non-empty → BeadColor; update counts
5. `emptyCount = count of nulls`

### Tolerance mapping

UI `tolerance` 0–100 → max channel-weighted distance or Euclidean RGB distance threshold.

Recommended:  
`threshold = (tolerance / 100) * 255 * √3` for Euclidean, or per-channel max-delta `tolerance * 2.55`.  
Use **max channel delta** (cheaper, predictable for flat fills):  
`max(|r-sr|,|g-sg|,|b-sb|) <= tolerance * 2.55`.

## Draw / export

- `paintPattern`: if cell null → fill light gray `#f0f2ef` or subtle checker; no code text; no highlight stroke
- `buildUsageLegend`: only counts entries (already non-empty)
- Summary line may add empty info only in UI, not required on PNG legend title
- Stats: `filled = width*height - emptyCount`

## App state

```ts
type ProcessMode = 'photo' | 'illustration'

const MODE_DEFAULTS = {
  photo: {
    bgRemoveEnabled: true,
    maxColors: 24,
    adjustments: IMAGE_PRESETS.photo, // brightness/contrast/sat
  },
  illustration: {
    bgRemoveEnabled: false,
    maxColors: 16,
    adjustments: NEUTRAL_PRESET,
  },
}
```

- `bgRemoveEnabled`, `bgTolerance` (default 32), `bgSampleRgb`
- `pickingBg` boolean: when true, source img `onClick` samples
- Sample: draw image to temp canvas, `getImageData` at click coords (account for object-fit / display size vs natural size)
- `scheduleGenerate` latestRef includes bg options
- Mode switch: apply MODE_DEFAULTS fields; **keep** `bgSampleRgb` if any; set enabled from defaults

### UI

- Mode segmented control near image adjust section
- 「去除背景」toggle + 容差 slider + 「在原图上取色」button
- Helper text: 辅助功能，复杂背景请调节容差
- Source image: cursor crosshair when picking

## Compatibility

| Area | Change |
|------|--------|
| highlight | skip null cells; clear if only empties |
| colorUsage counts | 0 for unused; empty not a color |
| total beads label | use filled count |
| export legend | unchanged logic on counts |

## Risks

1. Click coords wrong if CSS scales img → must map to natural pixels
2. Aggressive tolerance eats subject hair/edges → user-adjustable
3. Adjustments before bg compare: sample is from **unadjusted** original; compare should use **same space as pipeline after adjust** OR sample in original and compare before adjust. **Recommendation:** apply bg test on pixels **after** adjustments using sample converted… Simpler MVP: **compare after adjustments** but sample stored as raw RGB from original; document slight mismatch OR re-sample path: store sample and compare on pre-adjust buffer.  

**MVP choice:** keep a pre-adjust copy of ImageData for mask decisions (alpha + color distance on original colors), then adjust only non-masked pixels (or adjust full then force empty on mask). Cleanest:

```
getImageData
build emptyMask from alpha + (optional color on this data before adjust)
applyAdjustments to data
for each pixel: if emptyMask → null else match
```

Sample click reads original file pixels (natural size); mask built after scale using mapped color — scale then color-key on scaled buffer using sample RGB (same color space). Acceptable for flat backgrounds.

## Out of design

Flood-fill from click (only global color key in MVP), ML segmentation.
