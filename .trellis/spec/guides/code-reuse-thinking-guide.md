# Code Reuse Thinking Guide

> Search before you add a second copy of logic.

---

## Why it matters here

This codebase already burned once on **forked color metrics** and **pack = slice(0, N)**. Workshop + generate must share `color-match`; packs must use exact code lists.

---

## Before writing new code

```bash
# Similar symbol
rg -n "functionName|closestColor|estimateSplit" src worker

# Similar user-visible string
rg -n "屏幕色仅供参考|请至少启用" src
```

Ask:

| Question | If yes |
|----------|--------|
| Does `src/lib` already do this? | Import it |
| Is this the same dim-highlight as bead? | Reuse `drawPattern` / `HIGHLIGHT_DIM_ALPHA` |
| Second RGB distance? | **Stop** — use `color-match.ts` |
| New tab with async race? | Copy **generation token** pattern, not a new framework |
| New Worker route? | Follow `worker/index.ts` method + JSON error shape |

---

## Preferred reuse map

| Need | Reuse |
|------|--------|
| Nearest bead color | `closestColor` / `closestColorWithDistance` |
| Draw bead grid + highlight | `drawPattern` |
| Active palette | `resolvePalette` |
| XHS fetch + save | `xhsApi.ts` |
| Redirect allowlist fetch | `worker/xhs/redirect.ts` + allowlist helpers |
| Debounced regenerate | `latestRef` + `generationRef` in `App.tsx` (pattern, not a package) |

---

## When **not** to abstract

- One-off JSX layout for a single tab
- A pure function used once and under 15 lines (keep local until second call site)
- “Universal” form library for one input box

---

## Duplication smells

1. Copy-pasting `colorDistance` into workshop  
2. New median-cut npm dependency  
3. Second Turnstile script loader in another file without sharing the module-level promise  
4. Re-implementing `shellPageFromPath` in a feature  

---

## After you extract something

- Put pure logic under `src/lib/` (or `worker/xhs/` for server-only)
- Update `directory-structure.md` if you add a new top-level module
- Point both call sites at the same export in the same PR
