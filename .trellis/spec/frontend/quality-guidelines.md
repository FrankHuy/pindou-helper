# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Stack: Vite + React + TypeScript. Checks: `npm run build` (`tsc -b && vite build`), `npm run lint` (oxlint). Prefer pure-frontend algorithms; no new runtime deps unless justified.

---

## Forbidden Patterns

| Don't | Why |
|-------|-----|
| New runtime deps for median-cut / color math | PRD: self-implement; keep PWA offline-friendly |
| `colors.slice(0, N)` for merchant packs | Packs are non-contiguous code lists (e.g. 264 missing C29) |
| Reintroduce old 33-color MVP palette | Code/HEX conflict with real MARD |
| Server upload of user images | Privacy product promise — Canvas/local only |
| Silent empty palette matching | Must throw / UI error when no colors enabled |

---

## Required Patterns

- Chinese UI copy consistent with existing screens
- Screen-color disclaimer when showing palette swatches: **「屏幕色仅供参考」**
- Parameter changes that affect the pattern: debounced regenerate
- PNG export and PWA wiring must keep working after generation changes

---

## Pattern pipeline invariants

1. Adjustments run **before** quantization / palette match
2. Median-cut only when `0 < maxColors < palette.length`
3. Final cell colors always come from the active palette (`BeadColor` refs)
4. Unique colors used in a pattern is **≤ maxColors** when limited (may be strictly less after nearest-palette collapse)

---

## Testing Requirements

No unit test runner mandated yet. Minimum gate for generation/palette work:

1. `npm run build` passes
2. `npm run lint` clean for `src/`
3. Manual or script checks:
   - resolve counts: full 291 / standard 221 / extended 70
   - pack size N → N codes
   - maxColors=16 → `pattern.counts.size ≤ 16`
   - disable a used code → absent from next `counts`

---

## Code Review Checklist

- [ ] Merchant packs use exact codes
- [ ] `resolvePalette` layer order preserved
- [ ] `createPattern` signature uses `PatternOptions` (no old positional API)
- [ ] Debounce + generation token present for async generate
- [ ] Disclaimer visible on palette panel
- [ ] No new dependencies without task approval
