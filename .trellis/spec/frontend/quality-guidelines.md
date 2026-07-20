# Quality Guidelines

> Code quality standards for frontend + Worker in this project.

---

## Overview

Stack: Vite + React + TypeScript SPA, optional Cloudflare Worker (`worker/`) for XHS + public config.  
Checks: `npm run build` (`tsc -b && vite build`), `npm run lint` (oxlint).  
Prefer pure-frontend algorithms; **no new runtime deps** unless task-approved.

---

## Forbidden Patterns

| Don't | Why |
|-------|-----|
| New runtime deps for median-cut / color math / workshop CV | Offline-friendly PWA; self-implement |
| OCR libraries for legend text | Workshop product decision: swatch → MARD only |
| `colors.slice(0, N)` for merchant packs | Packs are non-contiguous code lists |
| Reintroduce old 33-color MVP palette | Code/HEX conflict with real MARD |
| Server upload of user images (bead **or** workshop) | Privacy — Canvas/local only |
| Silent empty palette matching | Must throw / UI error when no colors enabled |
| Browser hotlink of XHS CDN / open proxy | CORS/Referer fail; SSRF — use `/api/xhs/image` + allowlists |
| Login Cookie / private-note bypass for XHS | Public posts only |
| Hardcode Turnstile **secret** in repo or client | Secret only as Worker secret |
| Dual `colorDistance` implementations | Use `src/lib/color-match.ts` only |
| Privacy page copy about 小红书 / share download | Product compliance boundary for that page |

---

## Required Patterns

- Chinese UI copy consistent with existing screens
- Screen-color disclaimer when showing palette / workshop swatches: **「屏幕色仅供参考」**
- Parameter changes that affect bead pattern: debounced regenerate + generation token
- Workshop: generation token on analyze; keep decoded image for split retry
- PNG export and PWA wiring must keep working after generation changes
- XHS UI images only via same-origin `proxyPath`
- Feature CSS co-located; shell styles in `App.css`

---

## Pattern pipeline invariants (bead generate)

1. Empty mask (alpha + optional bg color-key) is built **before** adjustments; adjustments then run **before** quantization / palette match
2. Median-cut only when `0 < maxColors < palette.length`, and only on **non-empty** pixels
3. Final non-empty cell colors always come from the active palette (`BeadColor` refs); empty cells are `null`
4. Unique colors used in a pattern is **≤ maxColors** when limited (may be strictly less after nearest-palette collapse)
5. `counts` / export legend exclude empty cells; total beads = filled cells only
6. Preview `highlightCode` must not affect `exportPattern` pixels; export always includes usage legend; highlight skips null cells

---

## Workshop invariants

1. Local-only; no network for sheet bytes
2. Prefer grid → `BeadPattern` + `drawPattern`; else pixel labels + dim preview
3. Empty rule A: light background / far from palette → empty
4. Single-code highlight; dim non-focus with shared `HIGHLIGHT_DIM_ALPHA`
5. Analyze failure after decode must not wipe `imageData` (user can re-split)

---

## Worker / security invariants

1. Every redirect hop for XHS fetch validated against allowlists
2. Image proxy: HTTPS + host allowlist; no open proxy
3. Turnstile protects **`POST /api/xhs/parse` only** when `TURNSTILE_SECRET` set; `/api/xhs/image` not Turnstile-gated
4. `GET /api/config` exposes site key + `turnstileRequired` only — never the secret
5. JSON errors: `{ error: code, message: '中文…' }`

---

## Testing Requirements

No unit test runner mandated yet. Minimum gates:

1. `npm run build` passes
2. `npm run lint` clean for `src/` + `worker/` (ignore unrelated tooling trees unless you touched them)
3. Manual or script checks for palette work:
   - resolve counts: full 291 / standard 221 / extended 70
   - pack size N → N codes
   - maxColors=16 → `pattern.counts.size ≤ 16`
   - disable a used code → absent from next `counts`
4. Manual for workshop: export from bead tab → workshop upload → highlight + split retry
5. Manual for XHS when workerd available: invalid URL; parse with/without Turnstile secret behavior

---

## Code Review Checklist

- [ ] Merchant packs use exact codes
- [ ] `resolvePalette` layer order preserved
- [ ] `createPattern` uses `PatternOptions`; matching via `color-match`
- [ ] Debounce + generation token for bead generate
- [ ] Disclaimer visible on color panels (bead + workshop)
- [ ] Bead/workshop keep-alive `is-hidden` when required
- [ ] No new dependencies without task approval
- [ ] XHS: proxy paths only; allowlists intact; Turnstile secret not in client
- [ ] Privacy page still free of XHS product language
