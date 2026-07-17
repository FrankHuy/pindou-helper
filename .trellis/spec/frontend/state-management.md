# State Management

> How state is managed in this project.

---

## Overview

No global store. All interactive state is local React state in `App.tsx`. Derived palette resolution uses `useMemo`. Generation reads a **latest-params ref** so debounce closures never stale.

---

## State Categories

| Category | Examples | Storage |
|----------|----------|---------|
| Source image | `file`, `imageUrl` | `useState` |
| View chrome | `zoom`, `showGrid`, `showCodes`, `view`, `highlightCode` | `useState` (no regenerate) |
| Palette selection | `range`, `merchantPack`, `seriesFilter`, `disabledColors` | `useState` |
| Quality params | `targetWidth`, `maxColors`, `adjustments` | `useState` |
| Derived | `resolved`, `activePresetId`, `availableSeries` | `useMemo` |
| Async result | `pattern`, `busy`, `error` | `useState` |
| Concurrency | `latestRef`, `debounceRef`, `generationRef` | `useRef` |

---

## Pattern: Debounced regenerate without races

All params that affect the pattern call `scheduleGenerate()` (300ms).

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

## Palette UI defaults

| Param | Default |
|-------|---------|
| `range` | `'standard'` (221) |
| `merchantPack` | `null` (pack off) |
| `seriesFilter` | `null` (all series in scope) |
| `disabledColors` | empty `Set` |
| `maxColors` | `0` (unlimited) |
| `adjustments` | neutral / 原图 `(0,0,0)` |

Selecting a merchant pack **overrides** range for the active set; UI should dim range buttons and show “以商家套装为准”.

Changing range or pack should reset `seriesFilter` to `null` to avoid empty intersections.

---

## Highlight vs disable (palette rows)

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
