# 拼豆工作间图纸识别优化 — Implementation Plan

## Ordered Checklist

### 1. Pure functions — classify + cluster

- [x] 1.1 Add `src/lib/workshop/classify.ts`: `classifyCell(r, g, b, palette)` returning `{ type: 'background' | 'matched' | 'uncertain', color?, distance }`. Reuse `isLightBackground` + `closestColorWithDistance`. Threshold = 95 (same as `EMPTY_DISTANCE_THRESHOLD`).
- [x] 1.2 Add `src/lib/workshop/cluster.ts`: `clusterUncertainColors(samples: UncertainSample[], maxK = 10): UncertainCluster[]`. Greedy k-means with farthest-first seeding, 2 iterations. Sort by count desc, top K.
- [x] 1.3 Add types to `src/lib/workshop/types.ts`: `UncertainSample`, `UncertainCluster`, `ClusterAssignment`, `LegendExtraction`, `RecognitionWithUncertain`, `WorkshopPhase`.

### 2. Refactor analyze.ts — split into staged functions

- [x] 2.1 Add `extractLegendCandidates(image, splitY, fullPalette): LegendExtraction` — wraps `sampleLegendColors` + fallback to `mineColorsFromPattern`. No grid/pixel recognition.
- [x] 2.2 Add `recognizePattern(patternRegion, confirmedPalette, originalImage): RecognitionWithUncertain` — runs grid (modified `tryBuildGridPatternWithUncertain`) → pixel (`buildPixelAssignmentWithUncertain`). Collects uncertain samples + mask.
- [x] 2.3 Add `applyCorrections(recognition: RecognitionWithUncertain, assignments: ClusterAssignment[]): WorkshopAnalyzeOutput` — reassign uncertain cells/pixels per user decisions, rebuild counts + colors list, return final output.
- [x] 2.4 Keep `analyzeWorkshopFile` / `analyzeWorkshopImageData` for backward compat (auto-stages: accept all candidates, no uncertain correction).

### 3. Modify grid.ts — uncertain cell tracking

- [x] 3.1 Add `tryBuildGridPatternWithUncertain(patternRegion, palette)`.
- [x] 3.2 Keep existing `tryBuildGridPattern` for backward compat.

### 4. Modify pixel.ts — uncertain pixel tracking

- [x] 4.1 Add `buildPixelAssignmentWithUncertain(patternRegion, palette)`.
- [x] 4.2 Add `drawUncertainHighlight(...)`.
- [x] 4.3 Keep existing `buildPixelAssignment` for backward compat.

### 5. UI — Phase 1 palette confirm

- [x] 5.1 Add `phase: WorkshopPhase` state to `BeadWorkshopTab`.
- [x] 5.2 Replace auto-recognize on upload with `extractLegendCandidates` only.
- [x] 5.3 Render palette confirm section: chip list, legendFallback warning, add-color panel.
- [x] 5.4「确认色板」button.
- [x] 5.5 「重新识别」resets to Phase 1.
- [x] 5.6 Split line drag → re-extract legend candidates.

### 6. UI — Phase 2 recognition

- [x] 6.1 On「确认色板」, call `recognizePattern`.
- [x] 6.2 Show "正在识别图纸…" loading.
- [x] 6.3 On success: 0 uncertain → done; >0 → cluster + uncertain phase.
- [x] 6.4 On failure: show error, stay in palette with retry.

### 7. UI — Phase 3 uncertain color resolution

- [x] 7.1 Render cluster chip list.
- [x] 7.2 Canvas: draw uncertain highlight for selected cluster.
- [x] 7.3 Assignment chips + 「空格」.
- [x] 7.4 Track assignment progress.
- [x] 7.5「应用矫正」button.
- [x] 7.6「跳过，不确定色归空」button.

### 8. UI — Final result (phase `'done'`)

- [x] 8.1 Final result display matches current.
- [x] 8.2 Inventory start/end after `'done'`.
- [x] 8.3 activeSession lock + re-recognize warning preserved.

### 9. CSS

- [x] 9.1 Styles for palette confirm, add panel, clusters, assignment, skip.
- [x] 9.2 Reuse existing chip patterns where possible.

### 10. Validation

- [x] 10.1 `npm run build`
- [x] 10.2 `npm run lint`
- [x] 10.3 Manual: watermark sheet flow
- [x] 10.4 Manual: clean sheet → no uncertain → done
- [x] 10.5 Manual: Phase 3 skip
- [x] 10.6 Manual: re-recognize + inventory
- [x] 10.7 Manual: bead / XHS / login regression

## Validation Evidence (2026-07-29)

- `npm run build` passed. Wrangler emitted a read-only debug-log warning for
  `/root/.config/.wrangler/logs`, but Vite built both Worker and client bundles and
  the command exited successfully.
- `npm run lint` passed with only three pre-existing warnings under
  `.pi/extensions/trellis/`.
- Watermark sample `pics/test_inputs_1.jpg`: auto split at 89.8%, pattern-mined
  fallback candidates shown, palette reduced and supplemented to the 29 visible
  legend codes, pixel fallback produced 10 uncertain clusters, cluster selection
  changed the Canvas output, all clusters could be assigned and corrections applied.
- Phase 3 skip generated a final result; 「重新识别」 returned to palette confirmation
  and re-extracted candidates.
- Browser-generated clean local PNG: auto split at 74.8%, extracted A4/C6/F15/H7,
  then reached done directly with no uncertain phase.
- Network observation during uploads/recognition showed only local `blob:` reads and
  no image/API upload.
- Bead, XHS, and login surfaces rendered; switching tabs preserved the workshop
  result. Login route rendered at `/login`.
- With browser-local mocked session/inventory responses, start locked the four-code
  usage snapshot; re-recognize kept the active session and end controls visible;
  mocked deduct completed, cleared the session, and showed 「扣减完成」.

## Risky Files / Rollback Points

- `src/lib/workshop/analyze.ts` — core refactor; keep `analyzeWorkshopFile` / `analyzeWorkshopImageData` as backward-compat wrappers.
- `src/lib/workshop/grid.ts` / `pixel.ts` — add `*WithUncertain` variants, keep originals.
- `src/features/workshop/BeadWorkshopTab.tsx` — major UI refactor (phase state machine); preserve all existing handlers (inventory, zoom, highlight).
- `src/features/workshop/workshop.css` — additive only.
- Rollback: revert `BeadWorkshopTab.tsx` to single-shot; new pure modules can be left unused or removed.
