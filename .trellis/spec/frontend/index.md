# Frontend Development Guidelines

> Best practices for this Vite + React + TypeScript PWA and its Cloudflare Worker.

---

## Overview

Product surfaces:

1. **拼豆图纸** — local photo/illustration → MARD bead pattern (`App.tsx` + `src/lib/pattern.ts`)
2. **拼豆工作间** — import existing sheet, color highlight (`features/workshop` + `lib/workshop`)
3. **小红书下图** — public note parse + image proxy (`features/xhs` + `worker/xhs`)
4. **账号 / AI 护栏 / 极简管理** — `features/auth`, `features/admin` + `worker/auth|guard|admin|db` (D1)
5. **Privacy / About** — path shell pages (`features/info`); local tools + optional account/AI (not an XHS deep-dive)

Domain algorithms stay in `src/lib/**` (no React). Worker owns `/api/*` only.

---

## Pre-Development Checklist

Before changing **palette / bead generate**:

1. [Directory Structure](./directory-structure.md)
2. [Type Safety](./type-safety.md) — `resolvePalette`, `PatternOptions`, `color-match`
3. [State Management](./state-management.md) — debounce + latest-ref
4. [Quality Guidelines](./quality-guidelines.md) — forbidden pack/slice, pipeline invariants

Before changing **workshop**:

5. [Workshop](./workshop.md)
6. [Component Guidelines](./component-guidelines.md) — keep-alive tab, own upload

Before changing **XHS / Worker / Turnstile**:

7. [XHS Download](./xhs-download.md) — allowlists, parse/proxy, `/api/config`, Turnstile matrix

Before changing **auth / admin / AI quota / D1**:

8. [Directory Structure](./directory-structure.md) — `features/auth|admin`, `worker/auth|guard|admin|db`
9. [Quality Guidelines](./quality-guidelines.md) — session cookie, Resend runtime secrets, Turnstile host mount
10. Operator deploy notes: `docs/deploy-auth.md` (not injected as code-spec)

Before changing **shell / info pages / tabs**:

11. [Component Guidelines](./component-guidelines.md)
12. [Hook Guidelines](./hook-guidelines.md) — when *not* to extract hooks

Always skim [Quality Guidelines](./quality-guidelines.md) for privacy and dependency rules.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Layout, import boundaries, naming | Filled |
| [Component Guidelines](./component-guidelines.md) | Shell, tabs, styling, a11y bar | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Inline hook patterns; no hooks bag | Filled |
| [State Management](./state-management.md) | Shell / bead / workshop / XHS state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Forbidden/required patterns, gates | Filled |
| [Type Safety](./type-safety.md) | Domain + Worker contracts | Filled |
| [Workshop](./workshop.md) | Import sheet + highlight pipeline | Filled |
| [XHS Download](./xhs-download.md) | Worker parse/proxy + tab contracts | Filled |

---

## Design Decisions

### Palette / generate

1. **Real MARD 291 only** — no conflicting MVP table.
2. **Layered palette** — merchant pack overrides range; series + disabled orthogonal.
3. **Exact pack codes** — never `slice(0, N)`.
4. **Median-cut then map to palette** — finals always bead codes.
5. **Shared `color-match`** — one distance metric for generate + workshop.

### Workshop

1. **Consume sheets, do not generate** — complementary to bead tab.
2. **No OCR** — legend swatches → nearest MARD.
3. **Grid then pixel** — strict gates then mask fallback.
4. **Keep-alive mount** — preserve highlight/result across tabs.

### XHS

1. **Same-origin image proxy** — UI never hotlinks CDN.
2. **Turnstile on parse** — secret on Worker; site key via `/api/config` (auth reuses the same config).
3. **No ZIP / login bypass** — public posts only.

### Auth / AI cost / admin

1. **Workers + D1 self-hosted auth** — not Clerk/Supabase; binding name **`DB`**.
2. **AI expensive routes force login** — verified email, per-user daily quota, IP/fp associate caps, global circuit (`worker/guard/*`).
3. **Resend is runtime Worker env** — `RESEND_API_KEY` + `MAIL_FROM`; never `VITE_*` / build env.
4. **Turnstile explicit render** — wait for site key + host mount (auth `TurnstileField`); do not race empty ref.
5. **Mini admin** — SPA `/admin` + `/api/admin/*`; server role checks; super-only allowlist/role.

### Shell / privacy

1. **No react-router** — `ShellPage` + History API; SPA fallback on assets (`/login`, `/register`, `/verify`, `/admin`, …).
2. **Privacy** — local bead/workshop not uploaded; optional account + AI login gates; XHS remains share-URL only.
3. **About tip QR** — unlabeled; assets under `public/tip/`.

---

**Language**: Spec documents in **English**; product UI strings in **Chinese**.
