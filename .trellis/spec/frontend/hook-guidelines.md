# Hook Guidelines

> How React hooks are used — this project almost never extracts custom hooks.

---

## Overview

No `src/hooks/` directory and **no data-fetching library** (no React Query / SWR). Logic lives in:

- `App.tsx` — bead generate orchestration
- Feature tab components — local `useState` / `useRef` / `useEffect` / `useMemo` / `useCallback`
- Pure functions under `src/lib/**` — algorithms with zero React

**Default**: implement stateful UI in the feature component. Extract a `use*` hook only when the same async/UI lifecycle is copied across files (not the case today).

---

## Standard patterns (inline, not custom hooks)

### 1. Debounced work + generation token

Used by bead generate and workshop analyze.

```ts
const debounceRef = useRef<number | null>(null)
const generationRef = useRef(0)
const latestRef = useRef({ /* snapshot of params */ })
latestRef.current = { /* update every render */ }

// schedule: clearTimeout → setTimeout → read latestRef → ++generationRef
// on complete: if (gen !== generationRef.current) return
```

References: `App.tsx` (`scheduleGenerate` / `generate`), `BeadWorkshopTab.tsx` (`analyzeGenRef`).

### 2. Abort in-flight network

```ts
const parseAbortRef = useRef<AbortController | null>(null)
const parseGenRef = useRef(0)
// abort previous; new AbortController; pass signal to fetch
// discard results when gen mismatches
```

Reference: `XhsDownloadTab.tsx`.

### 3. Object URL lifecycle

```ts
useEffect(() => () => {
  if (url) URL.revokeObjectURL(url)
}, [url])
```

Reference: workshop source preview; bead `imageUrl` cleanup pattern.

### 4. Derived pure data

```ts
const resolved = useMemo(() => resolvePalette({…}), [deps])
```

Keep `resolvePalette` / `analyzeWorkshopImageData` **outside** React; only memoize at the boundary.

### 5. External script widgets (Turnstile)

- Module-level promise for single script insert
- `useEffect` depends on site key + host ref: `render` → store widget id → cleanup `remove`/`reset`
- Token in both `useState` (render) and `useRef` (submit without stale closure)

Reference: `XhsDownloadTab.tsx`.

### 6. Config fetch once

```ts
useEffect(() => {
  void fetchPublicConfig().then(…)
}, [])
```

Prefer runtime `/api/config` over build-only `import.meta.env` for deploy-time keys (Turnstile site key).

---

## Data fetching conventions

| Concern | Approach |
|---------|----------|
| XHS parse / image / config | `src/features/xhs/xhsApi.ts` — plain `fetch`, JSON errors → `Error(message)` |
| Bead / workshop images | Local `File` + Canvas; **never** upload |
| Caching | None client-side for API; browser HTTP cache only where Worker sets headers |

Do not introduce a global query cache unless product requires multi-view sync.

---

## Naming

- Components: `PascalCase` default export (`BeadWorkshopTab`)
- Handlers: `handle*` / `on*` / verb (`runAnalyze`, `scheduleGenerate`)
- Refs: `*Ref` suffix (`generationRef`, `canvasRef`)
- If extracting hooks later: `use` + camelCase (`useParseNote`) colocated with the feature, not a global hooks bag

---

## When to extract a custom hook

Extract only if **all** hold:

1. Two+ components need the same effect graph (abort + gen token + loading)
2. The hook would not pull in unrelated UI
3. Pure logic cannot live in `src/lib` instead

Prefer pure `src/lib` for anything testable without DOM.

---

## Common mistakes

| Mistake | Why | Fix |
|---------|-----|-----|
| Debounce closure over state without `latestRef` | Stale width/palette | Snapshot ref every render |
| No generation token on async | Out-of-order results flash wrong canvas | `++gen` + discard |
| Forget `AbortController` on XHS re-parse | Overlapping responses | Abort previous |
| Put median-cut / split heuristics inside a hook | Hard to reuse / test | `src/lib/pattern.ts`, `src/lib/workshop/*` |
| New hook file “for cleanliness” with one caller | Noise | Keep inline until second use |
