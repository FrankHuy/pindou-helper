# Quality Guidelines

> Code quality standards for frontend + Worker in this project.

---

## Overview

Stack: Vite + React + TypeScript SPA, Cloudflare Worker (`worker/`) for XHS, auth, AI guards, admin, public config.  
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
| Put `RESEND_API_KEY` / mail secrets in Vite `VITE_*` or build env | Auth mail uses **Worker runtime** `env` only |
| Claim email sent when `RESEND_API_KEY` missing | Dev log mode is undelivered — surface `emailSent: false` |
| Dual `colorDistance` implementations | Use `src/lib/color-match.ts` only |
| Privacy page copy that denies all accounts while product has login | Keep Privacy aligned with optional account + AI |

---

## Required Patterns

- Chinese UI copy consistent with existing screens
- Screen-color disclaimer when showing palette / workshop swatches: **「屏幕色仅供参考」**
- Parameter changes that affect bead pattern: debounced regenerate + generation token
- Workshop: generation token on analyze; keep decoded image for split retry
- PNG export and PWA wiring must keep working after generation changes
- XHS UI images only via same-origin `proxyPath`
- Feature CSS co-located; shell styles in `App.css`
- Inventory API client uses `credentials: include` (session cookie); login gate CTA when unauthenticated
- Inventory: grams ↔ beads conversion (`Math.round(value * 100)` for grams→beads); server and client validate non-negative integers
- Inventory: sparse D1 rows (no full palette prefill); `touched` flag marks entered/used codes for low-stock filtering
- Themeable UI chrome uses semantic CSS tokens from `src/index.css`; validate system/light/dark without filtering Canvas, images, QR codes, or color swatches

---

## Pattern pipeline invariants (bead generate)

1. Empty mask (alpha + optional bg color-key) is built **before** adjustments; adjustments then run **before** quantization / palette match
2. Median-cut only when `0 < maxColors < palette.length`, and only on **non-empty** pixels
3. Final non-empty cell colors always come from the active palette (`BeadColor` refs); empty cells are `null`
4. Unique colors used in a pattern is **≤ maxColors** when limited (may be strictly less after nearest-palette collapse)
5. `counts` / export legend exclude empty cells; total beads = filled cells only
6. Preview `highlightCode` must not affect `exportPattern` pixels; export always includes usage legend; highlight skips null cells
7. Pattern grid drawing lives only in `paintPattern` (`src/lib/pattern.ts`): when `showGrid && cellSize >= 7`, draw normal cell strokes then major helper lines every **5** rows and columns (darker/thicker same color family); helpers follow `showGrid` (off → neither); never fork major-line drawing in App/workshop callers

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
3. Turnstile: **`POST /api/xhs/parse`** and **auth register/login/forgot** when `TURNSTILE_SECRET` set; site key via `GET /api/config` only — never the secret
4. Explicit Turnstile: mount host **after** site key known; retry host ref a few frames; do not put unstable callbacks in the render-effect dep array (use refs)
5. Auth session cookie `pd_session` HttpOnly; store only token hash in D1; AI routes use `requireAiAccess`
6. Mail: `RESEND_API_KEY` + `MAIL_FROM` runtime; public mail diagnostics at most `hasResendApiKey` / `hasMailFrom` (never key value)
7. Admin: role checks on Worker; same-origin for mutating `/api/admin/*`
8. JSON errors: `{ error: code, message: '中文…' }`
9. Inventory: **login required, email verification NOT required** (gate stays on AI edit only)
10. Inventory: deduct **clamps to 0** (never negative); shortage is informational, not 409
11. Inventory: every mutation writes a ledger row inside the **same D1 batch** as the balance change (atomic)
12. Inventory: only color codes and quantities transmitted — **no sheet images uploaded**'
13. Inventory CSV: parse the original file locally; server accepts only validated MARD
    `{ code, quantity }[]` and derives `userId` from the current session

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
6. Manual for auth when D1+Resend configured: register allowlist domain; Turnstile on `/register`; resend via `/verify`; AI ping requires verified session
7. Manual for visual-system changes:
   - system/ light / dark selector and refresh persistence
   - system preference change while `ThemePreference === 'system'`
   - desktop + 900px + 620px/narrow mobile layouts
   - no root horizontal overflow (table/Canvas containers may scroll)
   - visible focus/disabled/error/success states in both themes
   - Canvas, uploaded images, QR images, and bead swatches keep original colors

## Scenario: Inventory matrix CSV import

### 1. Scope / Trigger

- Applies whenever inventory CSV parsing, import UI, inventory API payloads, MARD catalog bounds, or
  bulk inventory writes change. It preserves overwrite semantics, account isolation, and atomic history.

### 2. Signatures

- `parseInventoryCsv(text, validCodes): InventoryCsvResult` is pure and browser-independent.
- `PUT /api/inventory/import` accepts confirmed derived items only.
- `setQuantities(db, userId, items): Promise<void>` owns conditional ledger SQL plus bulk upserts;
  compute each old balance inside the same D1 batch, before its corresponding upsert.
- `normalizeMardCode(raw): string | null` is the Worker-side catalog gate; its bounds must stay in
  sync with `src/lib/palettes/mard-colors.ts`.

### 3. Contracts

- CSV matrix: first cell `系列`, positive integer suffix columns, unique alphabetic series rows.
- Non-empty cell means exact particle balance overwrite; blank means unchanged; `0` means clear.
- Request: `{ items: Array<{ code: string; quantity: number }> }`, 1–291 unique real MARD codes.
- Response: the current session user's `InventorySnapshot`; no client `userId` is accepted.
- The browser may display the local filename, but neither filename nor original CSV text is sent.
- Changed balances write `reason = 'adjust'` with `delta = new - old`; unchanged balances write no
  zero-delta ledger row.

### 4. Validation & Error Matrix

| Condition | API call/write | Required result |
|---|---:|---|
| BOM, CRLF/LF, quoted fields | Allowed after local parse | Same normalized matrix result |
| Blank quantity | Omitted | Existing balance unchanged |
| Negative, decimal, unsafe integer | No | Chinese row/column error |
| Duplicate suffix/series/code | No | Reject the whole import |
| Unknown MARD code | No | Client parser and Worker both reject |
| File over 1 MiB / more than 291 items | No | Reject before any D1 mutation |
| Extra request/item field, including `userId` | No | `400 invalid_request` |
| Valid confirmed items | One D1 batch | Upserts and non-zero `adjust` rows are atomic |

### 5. Good/Base/Bad Cases

- Good: `系列,1,2` plus `A,100,0` sets A1 to 100 and clears A2 for the signed-in user.
- Base: `A,,25` leaves A1 unchanged and overwrites only A2.
- Bad: a malformed quote, `ZZ999`, duplicate `A` row, or client-supplied `userId` performs no write.

### 6. Tests Required

- Parser harness: valid subset, blank/zero, BOM, CRLF, quotes/escaped quotes, duplicate row/column,
  unknown code, negative/decimal, malformed quote, 1 MiB limit, and 291-item cap.
- Catalog parity: all `MARD_COLORS` pass `normalizeMardCode`, count is 291, and out-of-range codes fail.
- Handler/D1 harness: request `userId` cannot override session ID; invalid payloads call no batch;
  valid overwrite uses one batch and records actual non-zero deltas for that session user.
- Run `npm run build`, `npm run lint`, and `git diff --check`; manually inspect narrow/light/dark UI.

### 7. Wrong vs Correct

```typescript
// Wrong: upload the CSV or trust an account identifier from the browser.
await fetch('/api/inventory/import', { body: JSON.stringify({ userId, csvText }) })

// Correct: parse locally and send only confirmed derived values; Worker uses session.user.id.
const { items, errors } = parseInventoryCsv(csvText, validCodes)
if (errors.length === 0) await importInventory(items)
await setQuantities(env.DB, session.user.id, items)
```

## Scenario: Production auth mail via Resend

### 1. Scope / Trigger

- Applies whenever auth mail behavior or Worker deployment variables change. It prevents production
  delivery from silently falling back to Resend's account-owner-only testing domain.

### 2. Signatures

- `sendAuthEmail(env: MailEnv, options): Promise<SendMailResult>` owns sender validation and the
  `POST https://api.resend.com/emails` call.
- Registration verification, resend verification, and password reset must all use this shared path.

### 3. Contracts

- `RESEND_API_KEY`: Cloudflare Secret; missing means local console mode and `emailSent: false`.
- `MAIL_FROM`: non-secret `wrangler.jsonc.vars` value on an exact Resend-verified domain.
- Production sender: `拼豆助手 <noreply@pindou.de5.net>`.
- Public failure diagnostics remain limited to `hasResendApiKey` and `hasMailFrom`; never return a
  key or sender address.

### 4. Validation & Error Matrix

| Condition | Fetch Resend | Required result |
|---|---:|---|
| API key missing | No | `mode: 'console'`; log development action link |
| `MAIL_FROM` missing with API key | No | `mode: 'config'`; actionable Chinese error |
| Sender domain is `resend.dev` | No | `mode: 'config'`; require a verified domain |
| Resend rejects request | Yes | `mode: 'resend'`; safe Chinese error |
| Resend accepts request | Yes | `ok: true`, `mode: 'resend'` |

### 5. Good/Base/Bad Cases

- Good: API key Secret plus `MAIL_FROM=拼豆助手 <noreply@pindou.de5.net>` sends real mail.
- Base: no API key locally logs the verification/reset URL and does not claim delivery.
- Bad: `onboarding@resend.dev` in production fails configuration validation before any fetch.

### 6. Tests Required

- Mock `fetch` and assert the missing-key, missing-sender, testing-domain, and verified-sender
  branches, including call count and exact `from` payload.
- Run `npm run build`, `npm run lint`, Wrangler dry-run, `git diff --check`, and a secret scan.
- After deploy, verify both registration and password-reset mail with a non-owner mailbox.

### 7. Wrong vs Correct

```typescript
// Wrong: silently selects Resend's testing-only sender in production.
const from = env.MAIL_FROM || 'onboarding@resend.dev'

// Correct: require the repository-declared, verified-domain sender for real delivery.
const from = env.MAIL_FROM?.trim()
if (env.RESEND_API_KEY && (!from || usesResendTestingDomain(from))) {
  return { ok: false, mode: 'config' }
}
```

---

## Code Review Checklist

- [ ] Merchant packs use exact codes
- [ ] `resolvePalette` layer order preserved
- [ ] `createPattern` uses `PatternOptions`; matching via `color-match`
- [ ] Debounce + generation token for bead generate
- [ ] Disclaimer visible on color panels (bead + workshop + inventory)
- [ ] Bead/workshop/inventory keep-alive `is-hidden` when required
- [ ] No new dependencies without task approval
- [ ] XHS: proxy paths only; allowlists intact; Turnstile secret not in client
- [ ] Privacy page still free of XHS product language
- [ ] Inventory: login required, email verification NOT required
- [ ] Inventory: deduct clamps to 0; ledger written atomically with balance change
- [ ] Inventory: no sheet images uploaded; only codes + quantities
- [ ] Inventory: all UI text in Chinese; units marked 颗 or g
- [ ] New UI chrome uses semantic tokens and has been checked in both light and dark themes
- [ ] Theme changes do not filter or recolor Canvas, source/result images, QR images, or swatches
