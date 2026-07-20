# State Management

> How state is managed in this project.

---

## Overview

**No global store** (no Redux / Zustand / Context for domain data). State is local to:

| Owner | State |
|-------|--------|
| `App.tsx` | Shell page, app tab, **entire bead generate UI** |
| `BeadWorkshopTab` | Upload, split, analyze result, highlight |
| `XhsDownloadTab` | Parse phase, result, lightbox, Turnstile |
| Info pages | Stateless + `onBack` |

Derived palette resolution uses `useMemo`. Bead generation reads a **latest-params ref** so debounce closures never stale.

---

## Shell state

```ts
type ShellPage = 'app' | 'privacy' | 'about'
type AppTab = 'bead' | 'workshop' | 'xhs'
```

- `shellPage` ↔ `location.pathname` (`shellPageFromPath`, `navigateShell` + `pushState` / `popstate`)
- `tab` switches feature panels; bead + workshop **keep-alive** via CSS hide

---

## Bead tab state categories

| Category | Examples | Storage |
|----------|----------|---------|
| Source image | `file`, `imageUrl` | `useState` |
| View chrome | `zoom`, `showGrid`, `showCodes`, `view`, `highlightCode` | `useState` (no regenerate) |
| Palette selection | `range`, `merchantPack`, `seriesFilter`, `disabledColors` | `useState` |
| Quality params | `targetWidth`, `maxColors`, `adjustments`, `processMode`, `bgRemoveEnabled`, `bgTolerance`, `bgSampleRgb` | `useState` |
| Derived | `resolved`, `activePresetId`, `availableSeries`, `colorUsage` | `useMemo` |
| Async result | `pattern`, `busy`, `error` | `useState` |
| Concurrency | `latestRef`, `debounceRef`, `generationRef` | `useRef` |

---

## Pattern: Debounced regenerate without races

All params that affect the pattern call `scheduleGenerate()` (~300ms).

```ts
const latestRef = useRef({ file, targetWidth, range, /* … */ })
latestRef.current = { file, targetWidth, range, /* … */ }

const generationRef = useRef(0)

// generate() reads latestRef.current, captures gen = ++generationRef.current
// on completion: if (gen !== generationRef.current) return  // discard stale
```

**Why**: width / palette / maxColors / adjustments all re-trigger; without refs + generation token, overlapping async `createPattern` calls race.

**Do not** put the full param list as `useCallback` deps for the debounced timer if the callback closes over state — use the ref snapshot instead.

---

## Workshop state (summary)

| Field | Role |
|-------|------|
| `imageData` | Kept after decode even if analyze fails (retry split) |
| `splitRatio` / `splitY` | Auto estimate + user drag |
| `result` | `WorkshopAnalyzeOutput` (grid or pixel) |
| `highlightCode` | Single-code dim highlight |
| `analyzeGenRef` | Discard stale analyze |

Analyze on upload settle and split **pointerup** / 「重新识别」 — not every `pointermove`.

---

## XHS state (summary)

| Field | Role |
|-------|------|
| `phase` | `idle` \| `loading` \| `success` \| `error` |
| `result` | Parse payload with `proxyPath` images |
| `turnstileToken` + ref | Widget token for parse body |
| `parseGenRef` + `AbortController` | Cancel superseded parse |

---

## Palette UI defaults (bead)

| Param | Default |
|-------|---------|
| `range` | `'standard'` (221) |
| `merchantPack` | `null` (pack off) |
| `seriesFilter` | `null` (all series in scope) |
| `disabledColors` | empty `Set` |
| `maxColors` | mode default (photo 24 / illustration 16); `0` = unlimited option |
| `adjustments` | mode defaults / presets |

Selecting a merchant pack **overrides** range for the active set; UI should dim range buttons and show “以商家套装为准”.

Changing range or pack should reset `seriesFilter` to `null` to avoid empty intersections.

---

## Process mode + background remove

- Modes: `photo` | `illustration`. **Switching applies that mode's default pack** (bg toggle, maxColors, adjustments) but **keeps** `bgSampleRgb` if set.
- Photo defaults: bg remove on, maxColors 24, photo preset. Illustration: bg off, maxColors 16, neutral.
- Color-key bg remove only when enabled **and** sample present; alpha→empty always.
- Sampling: `pickingBg` + source image click (map display → natural pixels); include bg fields in `latestRef` for debounced regenerate.

## Highlight vs disable (bead palette rows)

- **Click row body** → toggle `highlightCode` (only if `count > 0` and not disabled). View-only; does not regenerate.
- **Trailing icon button** → toggle disable (`stopPropagation`); may clear highlight if that code was focused.
- Clear `highlightCode` when the code becomes disabled or its count drops to 0 after regenerate.
- **Export PNG never applies highlight**; legend always lists full usage from `pattern.counts`.

## Preset vs manual sliders

- Choosing a preset writes all three adjustment fields.
- Dragging a slider updates fields; `matchImagePreset` clears active preset highlight when values no longer match any preset.

---

## Common Mistakes

### Stale generate closure

**Symptom**: UI shows new width/colors but canvas still uses old params.

**Cause**: `setTimeout(() => generate(file, width), 300)` closed over old values.

**Fix**: Always read `latestRef.current` inside the timeout / generate body.

### Empty active palette

**Symptom**: throw / error banner after user disables every color.

**Prevention**: surface `请至少启用一种颜色`; keep panel disable UI reversible.

### Workshop clears image on analyze error

**Symptom**: cannot drag split after first failure.

**Fix**: keep `imageData` + object URL after successful decode; only clear on decode failure (see `workshop.md`).
