# Bead Workshop (Import + Highlight)

> Local-only pipeline for the **拼豆工作间** tab: ingest an existing pattern sheet (pattern on top + legend below), recover MARD codes without OCR, highlight one color at a time.

---

## 1. Scope / Trigger

- Trigger: user uploads a PNG/JPG/WebP sheet in the workshop tab.
- Layers: `src/features/workshop/*` (UI) ↔ `src/lib/workshop/*` (pure analyze) ↔ `src/lib/color-match.ts` + `src/lib/pattern.ts` (`drawPattern`).
- Privacy: full browser Canvas / ImageData; **never** upload the sheet; no OCR libs; no new runtime deps.

---

## 2. Pipeline (three-phase interactive)

UI drives a phase machine: `idle → palette → recognizing → uncertain | done`.

1. Decode → `ImageData` (keep image even if later stages fail)
2. `estimateSplitY` or user `splitY` (`clampSplitY`: only 1px margins so both regions non-empty; **no** large % floor on user drag)
3. **Phase 1 — palette confirm**
   - `extractLegendCandidates(image, splitY, fullPalette)` → legend swatches → nearest full MARD codes
   - If no swatches → `mineColorsFromPattern` as suggested colors (`legendFallback: true`)
   - User may delete candidates / add from `MARD_COLORS` (series filter + search)
   - Confirm requires ≥ 1 color
4. **Phase 2 — pattern recognize**
   - `recognizePattern(image, splitY, confirmedPalette)` with restricted palette
   - Prefer **grid** (`tryBuildGridPatternWithUncertain`) → else **pixel** (`buildPixelAssignmentWithUncertain`)
   - Each cell/pixel classified via `classifyCell`: `background | matched | uncertain`
5. **Phase 3 — uncertain resolution** (skipped when no uncertain samples)
   - `clusterUncertainColors(samples, maxK=10)` — greedy farthest-first + 2 k-means iters; `colorDistance` only
   - User assigns each cluster to a confirmed code or empty; or skip → all uncertain → empty
   - `applyCorrections` rebuilds final `WorkshopAnalyzeOutput`
6. Final draw: grid → `drawPattern`; pixel → `drawPixelPreview`. Uncertain phase uses `drawUncertainHighlight`.

### Backward-compat single-shot

`analyzeWorkshopFile` / `analyzeWorkshopImageData` still auto-accept all legend candidates and treat far-from-palette as empty (original empty rule A). Interactive UI does **not** call them.

---

## 3. Signatures

```ts
// src/lib/workshop/analyze.ts — staged APIs
extractLegendCandidates(image, splitY, fullPalette): LegendExtraction
recognizePattern(image, splitY, confirmedPalette, legendFallback?): RecognitionWithUncertain
applyCorrections(recognition, assignments, clusters, confirmedPalette): WorkshopAnalyzeOutput
clusterUncertainColors(samples, maxK = 10): UncertainCluster[]
drawUncertainHighlight(canvas, recognition, clusters, selectedClusterId, zoom, dimAlpha?)

// Backward compat
analyzeWorkshopFile(file, fullPalette, splitY?): Promise<WorkshopAnalyzeOutput>
analyzeWorkshopImageData(image, options: AnalyzeOptions): WorkshopAnalyzeOutput

type WorkshopPhase = 'idle' | 'palette' | 'recognizing' | 'uncertain' | 'done'
// UncertainCluster.indices are indexes into uncertainSamples[], NOT pattern flat indexes.
// Always map via uncertainSamples[i].index before drawing / correcting cells.
```

UI highlight (done phase): `highlightCode: string | null`; dim uses `HIGHLIGHT_DIM_ALPHA` from `pattern.ts`.

---

## 4. Contracts

| Rule | Behavior |
|------|----------|
| Empty / classify | Light bg → background/empty; not bg + distance ≤ 95 → matched; not bg + distance > 95 → **uncertain** (interactive) or empty (compat single-shot) |
| Codes | No OCR; identity is nearest MARD from confirmed palette (legend or pattern mine + user edits) |
| Highlight | Single code on final result; focus full alpha; others dim; re-click clears |
| Uncertain highlight | Cluster chip selects cluster; map `cluster.indices` → `uncertainSamples[].index`; pixel block expand via `expandUncertainAssignments` (do not RGB-fuzzy match other clusters) |
| Grid gates | Cell size [4,80], dims [8,200], coverage / stability thresholds → else pixel |
| Re-analyze | 「重新识别」/ split pointer-up → **Phase 1** legend re-extract only; not every `pointermove`; does not auto-run Phase 2/3 |
| Inventory | Start/finish only from final `result` (`phase === 'done'`); active session stays visible through re-recognize; re-recognize does not change locked snapshot |

---

## 5. Wrong vs Correct

#### Wrong

```ts
// Upload sheet to server / OCR for codes
await fetch('/api/ocr', { body: file })
// Dual color-distance implementation
function myDistance(...) { /* fork */ }
// Treat cluster.indices as pattern cell indexes
cells[i] = selected.indices.includes(i) ? synth : cell
```

#### Correct

```ts
import { closestColor, colorDistance } from '../color-match'
import { extractLegendCandidates, recognizePattern, applyCorrections } from '../workshop/analyze'
// Local only; map sample-array indices first
const cellIdx = recognition.uncertainSamples[sampleIdx].index
```

---

## 6. UI conventions

- Tab label **拼豆工作间**; header subtitle `按色高亮已有图纸`
- Own upload control (do not reuse bead header upload)
- Keep section mounted with `is-hidden` like bead workspace
- Show mode badge: **格点识别** / **像素模式** (uncertain + done)
- Disclaimer **屏幕色仅供参考** on palette confirm and final color chips
- Phase copy in Chinese: 确认色板 / 正在识别图纸… / 不确定颜色 / 应用矫正 / 跳过，不确定色归空 / 至少选择一个色号
- Errors in Chinese: `无法读取图片` / `未识别到可用颜色，请调整分隔线后重试`

### Inventory start/finish integration

- **Start** button appears when `phase === 'done'`, `result.colors.some(c => c.count > 0)`, and user is logged in.
- Start builds an `InventoryUsageSnapshot` from `result.colors`, calculates shortages locally (warning-only, never blocks).
- During active session, locked snapshot stays on screen even if user re-enters palette phase; re-recognize does **not** change locked usage — show warning.
- **Finish** calls `POST /api/inventory/deduct` with the locked snapshot. Server clamps to 0 (never negative); shortage is informational.
- After finish: show low-stock list (codes below threshold) + shortage reminder from response.
- Start/end disabled when logged out or no final recognition result.
- Inventory state (snapshot, loading, error) is passed from App shell as props.

---

## 7. Common Mistakes

| Mistake | Why it breaks | Correct |
|---------|---------------|---------|
| Clear `imageData` / object URL when **analyze** throws | User cannot drag split or 「重新识别」 after first failure | Decode → keep `imageData` + preview URL → stage; only **decode** failures clear image |
| Re-run full recognize on every `pointermove` of the split | Main-thread jank on large sheets | Live line only while dragging; legend extract on `pointerup` / explicit button |
| Auto-run Phase 2 after re-extract | Bypasses palette confirm | 「重新识别」= Phase 1 only |
| Fork a second RGB distance in workshop | Grid/pixel/legend disagree with generate tab | Always `closestColor` / `colorDistance` from `src/lib/color-match.ts` |
| Use `cluster.indices` as cell/pixel indexes | Wrong cells highlighted / corrected | `uncertainSamples[sampleIdx].index` |
| Blind 2×2 expand of every sample in pixel corrections | Overwrites neighboring samples when block=1 | `expandUncertainAssignments` — expand only non-origin mask neighbors |
| Hide inventory section when `result` cleared mid-session | User loses end-制作 controls during re-recognize | Keep section if `activeSession` or `deductResult` |
| Upload sheet or add OCR dependency | Privacy + quality policy | Local Canvas only; codes from swatch → MARD |
