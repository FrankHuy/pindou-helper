# 拼豆工作间图纸识别优化 — Design

## Scope

Refactor the workshop recognition pipeline from a single-shot `analyzeWorkshopImageData` into a three-phase interactive flow:

1. **Phase 1 — Palette Confirm**: extract legend colors → user reviews / deletes / adds → confirm palette.
2. **Phase 2 — Pattern Recognize**: use confirmed palette as restricted palette → grid/pixel recognition (existing pipeline).
3. **Phase 3 — Uncertain Color Resolution**: cluster unmatched cells → user assigns each cluster to a confirmed color or empty → final result.

All changes are in `src/lib/workshop/*` (pure functions) and `src/features/workshop/*` (UI). No backend / Worker changes. No new dependencies.

## Architecture

### New pure modules

- `src/lib/workshop/classify.ts`
  - `classifyCell(r, g, b, palette)`: returns `{ type: 'background' | 'matched' | 'uncertain', color?, distance }`.
  - Separates background (light) from uncertain (not background + distance > threshold).
  - Reuses `isLightBackground` + `closestColorWithDistance` from existing modules.

- `src/lib/workshop/cluster.ts`
  - `clusterUncertainColors(samples: UncertainSample[], maxK = 10): UncertainCluster[]`.
  - Simple k-means (init = farthest-first / greedy) on RGB samples.
  - Each cluster: `{ representative: [r,g,b], count, indices }`.
  - Top-K by count; merge remainder into nearest cluster or discard tiny clusters (< 0.5% of uncertain pixels).

### Modified pure modules

- `src/lib/workshop/analyze.ts`
  - Split `analyzeWorkshopImageData` into composable stages:
    - `extractLegendCandidates(image, splitY, fullPalette)`: returns `{ colors: BeadColor[], legendFallback: boolean }` — Phase 1 logic only.
    - `recognizePattern(patternRegion, confirmedPalette, originalImage)`: runs grid → pixel, but classifies cells as matched / uncertain (not just matched / null). Returns `RecognitionWithUncertain`:
      ```ts
      type RecognitionWithUncertain = {
        mode: 'grid' | 'pixel'
        pattern?: BeadPattern       // cells with null for uncertain (pre-correction)
        pixel?: WorkshopPixelModel  // labels with -1 for uncertain
        uncertainSamples: UncertainSample[]  // RGB + position for clustering
        uncertainMask?: Uint8Array  // 1 = uncertain, 0 = matched/background (grid: cells, pixel: pixels)
        patternPreview?: ImageData
      }
      ```
    - `applyCorrections(recognition, assignments: ClusterAssignment[]): WorkshopAnalyzeOutput` — Phase 3 output: reassign uncertain cells/pixels per user decisions, rebuild counts, return final `WorkshopAnalyzeOutput`.

- `src/lib/workshop/grid.ts`
  - `tryBuildGridPatternWithUncertain(patternRegion, palette)`: like `tryBuildGridPattern`, but for unmatched cells (not background + distance > threshold), store the sampled RGB + cell index in `uncertainSamples` and set cell to `null`. Also return `uncertainMask: Uint8Array` marking which cells are uncertain.

- `src/lib/workshop/pixel.ts`
  - `buildPixelAssignmentWithUncertain(patternRegion, palette)`: like `buildPixelAssignment`, but classify each pixel/block as matched / background / uncertain. Store uncertain pixel RGB + position. Label = -1 for uncertain (same as background for now, but tracked separately via `uncertainMask`).

- `src/lib/workshop/empty.ts`
  - Add `classifyRgb(r, g, b, palette, threshold)` helper: returns `'background' | 'uncertain'` (background = `isLightBackground`; uncertain = not background + distance > threshold).
  - Keep existing `mapRgbToBead` unchanged for backward compat with Phase 2 internal usage.

### Types (`src/lib/workshop/types.ts`)

```ts
export type UncertainSample = {
  rgb: [number, number, number]
  /** Flat index into grid cells (mode grid) or pixel array (mode pixel) */
  index: number
}

export type UncertainCluster = {
  id: number
  representative: [number, number, number]
  count: number
  indices: number[]
}

export type ClusterAssignment = {
  clusterId: number
  /** Assigned bead code, or null for empty */
  code: string | null
}

export type LegendExtraction = {
  colors: import('../palette').BeadColor[]
  legendFallback: boolean
}

export type RecognitionWithUncertain = {
  mode: WorkshopMode
  pattern?: BeadPattern
  pixel?: WorkshopPixelModel
  uncertainSamples: UncertainSample[]
  uncertainMask?: Uint8Array
  patternPreview?: ImageData
  splitY: number
}

export type WorkshopPhase =
  | 'uploading'    // image decoded, waiting for split / legend extraction
  | 'palette'      // Phase 1: palette confirm
  | 'recognizing'  // Phase 2: running recognition (brief async)
  | 'uncertain'    // Phase 3: uncertain color resolution
  | 'done'         // final result ready
```

### UI changes (`src/features/workshop/BeadWorkshopTab.tsx`)

The component gains a `phase: WorkshopPhase` state that drives which sidebar section is visible.

#### Phase 1 Sidebar (palette confirm)

```
┌─ Upload + split line (existing) ─┐
├─ 「确认色板」 heading             │
│  [A1 ▪] [B3 ▪] [C5 ▪] ...        │ ← candidate chips with ✕ delete button
│  legendFallback warning if any    │
├─ 「+ 添加色号」 expandable panel  │
│  Series filter chips              │
│  Color list (MARD_COLORS minus    │
│    already-in-palette)            │
│  Click to add                     │
├─ 「确认色板」 button              │
│  disabled if palette empty        │
└───────────────────────────────────┘
```

User interactions:
- Click ✕ on a chip → remove from palette.
- Click a color in the add panel → add to palette (chip appears).
- Click「确认色板」→ Phase 2.

#### Phase 2 (brief, automatic)

- Show "正在识别图纸…" loading.
- On success → check uncertain count:
  - 0 uncertain → Phase 5 (`done`), set `result`.
  - > 0 uncertain → Phase 3 (`uncertain`).
- On failure → show error, stay in Phase 2 with retry.

#### Phase 3 Sidebar (uncertain color resolution)

```
┌─ Recognition result summary      │
│  模式：格点识别 / 像素模式         │
├─ 「不确定颜色」 heading           │
│  [● #FFEEAA  234 px] [● #CC2211  56 px] ...  │
│  Click chip → highlight those     │
│  cells/pixels on Canvas           │
├─ For selected cluster:           │
│  「归属色号」 dropdown / chips    │ ← confirmed palette X colors + 「空格」
│  [A1] [B3] [C5] ... [空格]       │
│  Click to assign                  │
├─ Progress: 3/6 已决策             │
├─ 「应用矫正」 button (disabled    │
│    until all clusters assigned)   │
├─ 「跳过，不确定色归空」 button    │
└───────────────────────────────────┘
```

Canvas during Phase 3:
- Draw the current recognition result with `highlightCode = null`.
- When a cluster is selected, highlight uncertain cells/pixels belonging to that cluster in full color, dim everything else.
- This shows user WHERE the uncertain color appears in the pattern.

After「应用矫正」or「跳过」:
- Build final `WorkshopAnalyzeOutput` via `applyCorrections`.
- Set `result` → Phase 5 (`done`).
- Canvas draws final result (grid: `drawPattern`, pixel: `drawPixelPreview`).
- Color list visible, highlight works as before.
- Inventory start/end buttons appear (same as current).

#### Phase 5 (`done`) — final result

Identical to current workshop result display:
- Mode badge, stats label, color grid, highlight.
- Inventory start/finish section unchanged.

#### 「重新识别」 behavior change

- Resets to Phase 1 (`palette`), re-extracts legend candidates.
- Does NOT auto-run Phase 2/3.

### Drawing during uncertain phase

Need a new draw function for highlighting uncertain clusters:

- `drawUncertainHighlight(canvas, recognition, clusters, selectedClusterId, zoom)`:
  - Grid mode: draw `BeadPattern` where uncertain cells of the selected cluster are drawn in their representative RGB, matched cells are dimmed, background stays light.
  - Pixel mode: similar using `patternPreview` + `uncertainMask`.

This lives in `src/workshop/pixel.ts` (for pixel) or inline in the component (for grid, using `drawPattern` with a modified pattern).

Alternatively, build a temporary `BeadPattern` where selected cluster's uncertain cells get a special code, and use `drawPattern` with `highlightCode` set to that code. This is simpler.

## Data Flow

```
Upload → decode ImageData
  → extractLegendCandidates(image, splitY)           [Phase 1]
  → user confirms palette (BeadColor[])
  → recognizePattern(patternRegion, confirmedPalette)  [Phase 2]
    → classify each cell/pixel:
        background → null/empty
        matched    → assigned code
        uncertain  → null + sample collected
  → if uncertainSamples.length == 0 → done
  → else → clusterUncertainColors(samples, K=10)     [Phase 3]
  → user assigns each cluster
  → applyCorrections(recognition, assignments)       [Phase 3 → done]
  → WorkshopAnalyzeOutput (final result)
```

## Compatibility

- `analyzeWorkshopFile` API stays for external callers — internally calls the three stages sequentially with auto-confirm (all candidates accepted, no uncertain correction). This preserves backward compat if any other code calls it.
- `WorkshopAnalyzeOutput` type unchanged — the final result after Phase 3 is the same shape.
- Inventory integration reads `result.colors` — available only after Phase 5 (`done`).
- `drawPattern` / `drawPixelPreview` unchanged.
- Keep-alive mounting unchanged (still `is-hidden` in App).

## Cluster Algorithm

Simple greedy k-means:

1. Collect uncertain RGB samples (with positions).
2. If samples ≤ K: each sample is its own cluster.
3. Else: initialize K centroids using "farthest first" seeding:
   - Start with the most common (by histogram) RGB.
   - Pick next centroid = sample farthest from existing centroids.
   - Repeat until K centroids.
4. One pass of assignment (nearest centroid by `colorDistance`).
5. Update centroids = mean of assigned samples.
6. One more assignment pass for stability.
7. Return clusters sorted by pixel count descending, top K (10).

Complexity: O(N * K) per iteration, K=10, N = uncertain sample count (typically < 5000 after grid cell sampling, < 50000 for pixel). Two iterations = fast enough on main thread.

## Trade-offs

| Choice | Pros | Cons |
|--------|------|------|
| Three-phase interactive | User controls palette; watermark handled | More state in component; more cognitive steps |
| K=10 cluster cap | Covers most watermark colors | Could miss edge cases > 10 distinct uncertain colors |
| Greedy k-means (2 iterations) | Fast, no dependency | Less optimal than full k-means; acceptable for MVP |
| Uncertain = null until corrected | Matches existing null = empty convention | Needs `uncertainMask` to distinguish from background |
| Phase 3 skippable | User not blocked | Uncertain colors lost (treated as empty) |

## Rollback

1. Revert `BeadWorkshopTab.tsx` to single-shot `analyzeWorkshopImageData`.
2. Leave new pure modules (`classify.ts`, `cluster.ts`) unused or remove.
3. No DB / Worker changes to undo.
