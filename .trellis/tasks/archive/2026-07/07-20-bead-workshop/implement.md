# Implementation Plan — 拼豆工作间

## Checklist

### 1. Shared color match extract
- [ ] 1.1 Extract `colorDistance` + `closestColor` to `src/lib/color-match.ts`  
- [ ] 1.2 Wire `pattern.ts` imports; ensure createPattern / draw unchanged behaviorally  
- [ ] 1.3 `npm run build` smoke after extract  

### 2. Pure analyze library
- [ ] 2.1 `src/lib/workshop/types.ts` — WorkshopResult / mode / colors  
- [ ] 2.2 `split.ts` — estimateSplitY + clamps  
- [ ] 2.3 `legend.ts` — swatch sample → MARD BeadColor[] (dedupe)  
- [ ] 2.4 `grid.ts` — tryBuildGridPattern with confidence gates → BeadPattern \| null  
- [ ] 2.5 `pixel.ts` — label map + empty heuristics  
- [ ] 2.6 `analyze.ts` — orchestrate: legend → grid try → pixel fallback; pattern-only colors if legend empty  

### 3. Workshop UI tab
- [ ] 3.1 `src/features/workshop/BeadWorkshopTab.tsx` + `workshop.css`  
- [ ] 3.2 Upload, split handle, re-analyze, mode label, color chips, highlight toggle  
- [ ] 3.3 Grid preview via `drawPattern`; pixel preview via canvas mask dim  
- [ ] 3.4 「屏幕色仅供参考」+ 中文错误  

### 4. App shell
- [ ] 4.1 `AppTab` += `'workshop'`; tab button **拼豆工作间**  
- [ ] 4.2 Mount workshop with `is-hidden` keep-alive like bead  
- [ ] 4.3 Header subtitle for workshop; do not bind bead upload to workshop  

### 5. Specs / docs
- [ ] 5.1 Update `.trellis/spec/frontend/directory-structure.md` (workshop paths)  
- [ ] 5.2 Optional short note in quality or new `workshop.md` for analyze contract  
- [ ] 5.3 README feature bullet for 拼豆工作间  

### 6. Validate
- [ ] 6.1 `npm run build` && `npm run lint`  
- [ ] 6.2 Manual: export from bead tab → open workshop → auto/grid path → highlight  
- [ ] 6.3 Manual: drag split → re-analyze; pixel fallback still highlights  
- [ ] 6.4 Tab switch preserves workshop + bead state  

## Validation commands

```bash
npm run build
npm run lint
```

## Review gates

- No OCR / no new runtime deps  
- No upload of workshop images  
- Grid failure must not hard-crash — pixel fallback or Chinese error  
- Existing bead generate + XHS + privacy/about untouched in behavior  
- color-match single source of truth  

## Rollback points

1. After color-match extract only — safe refactor  
2. After lib/workshop without UI — dead code removable  
3. After full tab — delete feature + revert AppTab  

## Order

1. color-match extract  
2. lib/workshop analyze  
3. BeadWorkshopTab UI  
4. App shell tab wire  
5. specs + README  
6. build/lint + manual gates  

## Risky areas

- `src/lib/pattern.ts` extract — regression on generate/export  
- Grid heuristics overfit to one export size — keep gates strict  
- Large ImageData on main thread — debounce + downscale  
