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
| Server upload of user images (bead path) | Privacy product promise — Canvas/local only |
| Silent empty palette matching | Must throw / UI error when no colors enabled |
| Browser hotlink of XHS CDN / open proxy | CORS/Referer fail; SSRF — use `/api/xhs/image` + allowlists |
| Login Cookie / private-note bypass for XHS | Compliance boundary; public posts only |

---

## Required Patterns

- Chinese UI copy consistent with existing screens
- Screen-color disclaimer when showing palette swatches: **「屏幕色仅供参考」**
- Parameter changes that affect the pattern: debounced regenerate
- PNG export and PWA wiring must keep working after generation changes

---

## Pattern pipeline invariants

1. Empty mask (alpha + optional bg color-key) is built **before** adjustments; adjustments then run **before** quantization / palette match
2. Median-cut only when `0 < maxColors < palette.length`, and only on **non-empty** pixels
3. Final non-empty cell colors always come from the active palette (`BeadColor` refs); empty cells are `null`
4. Unique colors used in a pattern is **≤ maxColors** when limited (may be strictly less after nearest-palette collapse)
5. `counts` / export legend exclude empty cells; total beads = filled cells only
6. Preview `highlightCode` must not affect `exportPattern` pixels; export always includes usage legend; highlight skips null cells

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
