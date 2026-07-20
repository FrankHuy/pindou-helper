# Bead Workshop (Import + Highlight)

> Local-only pipeline for the **拼豆工作间** tab: ingest an existing pattern sheet (pattern on top + legend below), recover MARD codes without OCR, highlight one color at a time.

---

## 1. Scope / Trigger

- Trigger: user uploads a PNG/JPG/WebP sheet in the workshop tab.
- Layers: `src/features/workshop/*` (UI) ↔ `src/lib/workshop/*` (pure analyze) ↔ `src/lib/color-match.ts` + `src/lib/pattern.ts` (`drawPattern`).
- Privacy: full browser Canvas / ImageData; **never** upload the sheet; no OCR libs; no new runtime deps.

---

## 2. Pipeline

1. Decode → `ImageData`
2. `estimateSplitY` or user `splitY` (clamp pattern ≥40%, legend ≥8%)
3. Legend region → swatch sample → nearest **full MARD** codes (dedupe)
4. If no swatches → mine unique colors from pattern region + Chinese hint
5. Pattern region mapped with restricted palette + empty rule A
6. Prefer **grid** reconstruction → `BeadPattern` + `drawPattern`
7. Else **pixel** labels + dim highlight on pattern crop

---

## 3. Signatures

```ts
// src/lib/workshop/analyze.ts
analyzeWorkshopFile(file: File, fullPalette: BeadColor[], splitY?: number): Promise<WorkshopAnalyzeOutput>
analyzeWorkshopImageData(image: ImageData, options: AnalyzeOptions): WorkshopAnalyzeOutput

type WorkshopMode = 'grid' | 'pixel'
type WorkshopResult = {
  mode: WorkshopMode
  colors: WorkshopColor[]  // code, hex, rgb, count
  pattern?: BeadPattern    // grid
  pixel?: { width; height; labels: Int16Array } // -1 empty
  splitY: number
  legendFallback: boolean
}
```

UI highlight: `highlightCode: string | null` toggles; dim uses `HIGHLIGHT_DIM_ALPHA` from `pattern.ts`.

---

## 4. Contracts

| Rule | Behavior |
|------|----------|
| Empty (A) | Near-white / low-sat light gray → empty; distance to palette > threshold → empty |
| Codes | No OCR; identity is nearest MARD from legend (or pattern mine) |
| Highlight | Single code; focus full alpha; others dim; re-click clears |
| Grid gates | Cell size [4,80], dims [8,200], coverage / stability thresholds → else pixel |
| Re-analyze | On pointer-up after split drag or 「重新识别」; not every move |

---

## 5. Wrong vs Correct

#### Wrong

```ts
// Upload sheet to server / OCR for codes
await fetch('/api/ocr', { body: file })
// Dual color-distance implementation
function myDistance(...) { /* fork */ }
```

#### Correct

```ts
import { closestColor } from '../color-match'
import { analyzeWorkshopFile } from '../workshop/analyze'
// Local only
const result = await analyzeWorkshopFile(file, MARD_COLORS)
```

---

## 6. UI conventions

- Tab label **拼豆工作间**; header subtitle `按色高亮已有图纸`
- Own upload control (do not reuse bead header upload)
- Keep section mounted with `is-hidden` like bead workspace
- Show mode badge: **格点识别** / **像素模式**
- Disclaimer **屏幕色仅供参考** on color chips
- Errors in Chinese: `无法读取图片` / `未识别到可用颜色，请调整分隔线后重试`

---

## 7. Common Mistakes

| Mistake | Why it breaks | Correct |
|---------|---------------|---------|
| Clear `imageData` / object URL when **analyze** throws | User cannot drag split or 「重新识别」 after first failure (AC4 / R8) | Decode → keep `imageData` + preview URL → analyze; only **decode** failures clear image |
| Re-run full analyze on every `pointermove` of the split | Main-thread jank on large sheets | Live line only while dragging; analyze on `pointerup` / explicit button |
| Fork a second RGB distance in workshop | Grid/pixel/legend disagree with generate tab | Always `closestColor` / `colorDistance` from `src/lib/color-match.ts` |
| Upload sheet or add OCR dependency | Privacy + quality policy | Local Canvas only; codes from swatch → MARD |
