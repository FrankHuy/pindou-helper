# Implementation Plan — empty cells + bg modes

## Checklist

### 1. pattern.ts core
- [x] 1.1 `PatternCell = BeadColor | null`; `emptyCount` on `BeadPattern`
- [x] 1.2 `PatternOptions.backgroundRemove` + `alphaThreshold`
- [x] 1.3 Build empty mask (alpha + optional color key) before match
- [x] 1.4 Quantize/match only non-empty; counts exclude empty
- [x] 1.5 `paintPattern` / legend / export handle null cells
- [x] 1.6 Highlight path skips null

### 2. App.tsx UI + state
- [x] 2.1 `processMode` + MODE_DEFAULTS apply on switch
- [x] 2.2 bgRemove enabled, tolerance 0–100 default 32, sampleRgb
- [x] 2.3 Pick mode on source image; map click → natural pixel RGB
- [x] 2.4 latestRef + scheduleGenerate includes bg options
- [x] 2.5 Stats: 颗数 = filled; show 空 N 格
- [x] 2.6 Helper copy for bg remove

### 3. CSS
- [x] 3.1 Mode chips, pick cursor, tolerance control layout

### 4. Validate
- [x] 4.1 `npm run build`
- [x] 4.2 `npm run lint` (src)
- [ ] 4.3 Manual: transparent PNG; white-bg click; mode switch defaults

## Validation

```bash
npm run build
npm run lint
```

**Results (implement agent):**
- `npm run build` — pass
- `npm run lint` — pass for `src/` (only pre-existing warnings under `.pi/extensions/`)

## Review gates

- No bead in counts for empty cells
- Export legend has no ghost colors from background when removed
- Illustration mode defaults do not force bg remove

## Rollback

- Revert pattern cell type + App bg UI if export breaks
