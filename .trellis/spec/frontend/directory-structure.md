# Directory Structure

> How code is organized in this single-package repo.

---

## Overview

Vite + React + TypeScript PWA with an optional Cloudflare Worker:

| Area | Path | Responsibility |
|------|------|----------------|
| Shell + bead UI | `src/App.tsx`, `App.css` | Tabs, generate orchestration, footer, path shell |
| Domain (pure) | `src/lib/**` | Palette, pattern, workshop analyze, color-match, presets |
| Features | `src/features/**` | Tab/page UI + co-located CSS / client helpers |
| Worker | `worker/**` | `/api/*` (config, auth, XHS parse/proxy) |
| Static | `public/**` | PWA assets, About tip QR |
| Chart sources | `requirements/**` | Generate palette constants (not runtime-imported) |
| Offline XHS demo | `scripts/xhs_image_demo.py` | Reference only |

---

## Directory Layout

```
src/
├── App.tsx                 # ShellPage + AppTab + bead UI / debounced generate
├── App.css
├── main.tsx
├── index.css
├── features/
│   ├── info/               # Privacy / About (path shell pages)
│   │   ├── PrivacyPage.tsx
│   │   ├── AboutPage.tsx
│   │   └── info.css
│   ├── workshop/           # 拼豆工作间 tab
│   │   ├── BeadWorkshopTab.tsx
│   │   └── workshop.css
│   ├── xhs/                # 小红书下图 tab
│   │   ├── XhsDownloadTab.tsx
│   │   ├── xhsApi.ts
│   │   └── xhs.css
│   ├── auth/               # login/register/reset/verify shell pages
│   │   ├── AuthPages.tsx
│   │   ├── AuthSessionBar.tsx
│   │   ├── TurnstileField.tsx
│   │   ├── authApi.ts
│   │   ├── fingerprint.ts
│   │   └── auth.css
│   └── admin/              # Phase 1 mini admin shell page (/admin)
│       ├── AdminPage.tsx
│       ├── adminApi.ts
│       └── admin.css
└── lib/
    ├── color-match.ts      # Shared RGB distance + closestColor*
    ├── palette.ts          # Compat re-export of palette types/colors
    ├── pattern.ts          # createPattern / drawPattern / exportPattern
    ├── presets.ts
    ├── workshop/           # Pure import-sheet analyze (no React)
    │   ├── analyze.ts
    │   ├── split.ts
    │   ├── legend.ts
    │   ├── grid.ts
    │   ├── pixel.ts
    │   ├── empty.ts
    │   ├── image-data.ts
    │   └── types.ts
    └── palettes/
        ├── types.ts
        ├── mard-colors.ts
        ├── mard-packs.ts
        ├── resolve.ts
        └── index.ts

worker/
├── index.ts                # Routes: /api/config, /api/auth/*, /api/me, /api/admin/*, /api/ai/*, /api/xhs/*
├── auth/                   # credentials, sessions, verify/reset mail
├── admin/                  # mini admin APIs + authz
├── guard/                  # AI quota / circuit preflight
├── db/                     # D1 config + usage_daily helpers
└── xhs/
    ├── handlers.ts
    ├── parse.ts
    ├── proxy.ts
    ├── allowlist.ts
    ├── redirect.ts
    ├── turnstile.ts
    └── types.ts

public/
├── tip/                    # qr-a.jpg, qr-b.jpg (About)
├── manifest.webmanifest
└── sw.js
```

---

## Module Organization

| Concern | Location | Rule |
|---------|----------|------|
| Brand color tables | `src/lib/palettes/*-colors.ts` | One file per brand; pure data |
| Merchant packs | `src/lib/palettes/*-packs.ts` | Exact `code[]`, never `slice` |
| Selection → active set | `src/lib/palettes/resolve.ts` | Pure; fixed layer order |
| Shared color distance | `src/lib/color-match.ts` | Pattern + workshop only metric |
| Pattern generation | `src/lib/pattern.ts` | Canvas/ImageData; no UI imports |
| Workshop analyze | `src/lib/workshop/*` | Local only; no OCR / network |
| Image presets | `src/lib/presets.ts` | Adjustment values + match helper |
| Bead UI | `src/App.tsx` | Keep mounted when hidden |
| Workshop UI | `src/features/workshop/*` | Own upload; keep-alive host in App |
| Info pages | `src/features/info/*` | Static copy; Privacy bead-only wording |
| XHS UI + client | `src/features/xhs/*` | Same-origin `/api/*` only |
| XHS Worker | `worker/xhs/*` | Allowlists, parse, proxy, Turnstile |
| Auth UI | `src/features/auth/*` | Shell pages + session chip; credentials include |
| Auth Worker | `worker/auth/*`, `worker/db/*` | D1 users/sessions; no `src/` imports |
| Admin UI | `src/features/admin/*` | Mini ops page; hide link unless admin/super; API still enforces |
| Admin Worker | `worker/admin/*` | `/api/admin/*` role matrix; no `src/` imports |

### Import boundaries

```
features/xhs  ──► /api/* (network)     ✗ bead lib pattern generate
features/workshop ──► lib/workshop, color-match, pattern.draw, palettes
features/info ──► none of the above domain pipelines
App.tsx ──► features + lib (orchestration)
lib/* ──► no React, no features/*
worker/* ──► no src/ imports
```

### Adding a new brand (COCO / 漫漫 / …)

1. Add `src/lib/palettes/<brand>-colors.ts` and optional `<brand>-packs.ts`
2. Wire exports in `palettes/index.ts`
3. Extend UI brand selector only — do **not** bake brand logic into `pattern.ts` or `workshop/*`

### Adding a new app tab

1. `src/features/<name>/` with default export tab component + CSS  
2. Extend `AppTab` union + tab button in `App.tsx`  
3. Prefer keep-alive `is-hidden` if local image/result state must survive switches  
4. Document in this file + feature-specific spec if cross-layer

---

## Naming Conventions

- Files: `kebab-case.ts` for multi-word modules (`mard-colors.ts`, `color-match.ts`)
- Components: `PascalCase.tsx` (`BeadWorkshopTab.tsx`)
- Types: `PascalCase` in `types.ts` or co-located
- Constants: `SCREAMING_SNAKE` for tables (`MARD_COLORS`, `MARD_PACKS`)

---

## Examples

- Palette layering: `src/lib/palettes/resolve.ts`
- Pattern options: `src/lib/pattern.ts` → `PatternOptions`
- Workshop analyze: `src/lib/workshop/analyze.ts`
- Worker entry routes: `worker/index.ts`
