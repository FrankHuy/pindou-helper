# Directory Structure

> How frontend code is organized in this project.

---

## Overview

Single-package Vite + React + TypeScript app with an optional Cloudflare Worker for the XHS tab.
Bead domain logic lives under `src/lib/`; shell UI in `src/App.tsx`; feature tabs under `src/features/` + `worker/` for XHS.

---

## Directory Layout

```
src/
├── App.tsx                 # Shell tabs + bead UI state / debounced generate
├── App.css
├── main.tsx
├── index.css
├── features/
│   ├── info/               # Privacy / About pages (static copy + tip QR)
│   │   ├── PrivacyPage.tsx
│   │   ├── AboutPage.tsx
│   │   └── info.css
│   ├── workshop/           # “拼豆工作间” tab (import existing pattern sheets)
│   │   ├── BeadWorkshopTab.tsx
│   │   └── workshop.css
│   └── xhs/                # Independent “小红书下图” tab (no bead imports)
│       ├── XhsDownloadTab.tsx
│       ├── xhsApi.ts       # parse/save client helpers
│       └── xhs.css
└── lib/
    ├── color-match.ts      # Shared RGB distance + closestColor
    ├── palette.ts          # Re-export shell (compat path)
    ├── pattern.ts          # Image → bead pattern pipeline + draw/export
    ├── presets.ts          # Image adjustment presets
    ├── workshop/           # Pure analyze for imported pattern sheets (no React)
    │   ├── analyze.ts      # Orchestrate split / legend / grid|pixel
    │   ├── split.ts
    │   ├── legend.ts
    │   ├── grid.ts
    │   ├── pixel.ts
    │   ├── empty.ts
    │   ├── image-data.ts
    │   └── types.ts
    └── palettes/           # Multi-brand-ready palette data + resolve
        ├── types.ts
        ├── mard-colors.ts  # Full brand color table (generated from requirements JSON)
        ├── mard-packs.ts   # Merchant pack code lists (exact codes, not slice)
        ├── resolve.ts      # Layered selection → active colors
        └── index.ts

worker/
├── index.ts                # Cloudflare Worker entry (/api/*)
└── xhs/                    # Parse + proxy (port of scripts/xhs_image_demo.py)
    ├── handlers.ts
    ├── parse.ts
    ├── proxy.ts
    ├── allowlist.ts
    ├── redirect.ts
    ├── turnstile.ts        # Optional siteverify for parse anti-abuse
    └── types.ts

public/tip/                 # About tip QR images (qr-a.jpg, qr-b.jpg)
```

Source chart data used to *generate* palette constants lives in repo root `requirements/` (not imported at runtime).
Offline XHS demo: `scripts/xhs_image_demo.py` (not a production runtime).

---

## Module Organization

| Concern | Location | Rule |
|---------|----------|------|
| Brand color tables | `src/lib/palettes/*-colors.ts` | One file per brand; pure data + series constants |
| Merchant / retail packs | `src/lib/palettes/*-packs.ts` | Exact `code[]` per pack size |
| Selection → active set | `src/lib/palettes/resolve.ts` | Pure function; no React |
| Shared color distance | `src/lib/color-match.ts` | Used by pattern + workshop; single metric |
| Pattern generation | `src/lib/pattern.ts` | Canvas/ImageData only; no UI imports |
| Workshop analyze | `src/lib/workshop/*` | Pure TS; local Canvas only; no OCR / no network |
| Image presets | `src/lib/presets.ts` | Shared adjustment values + match helper |
| Bead UI wiring | `src/App.tsx` | State + debounce + canvas draw/export; keep mounted when hiding tab |
| Workshop UI | `src/features/workshop/*` | Own upload + split handle; keep-alive via `is-hidden` |
| XHS UI + client API | `src/features/xhs/*` | Talks only to same-origin `/api/xhs/*` |
| XHS Worker | `worker/xhs/*` | Host allowlists, parse INITIAL_STATE, image proxy + Referer |

### Adding a new brand (COCO / 漫漫 / …)

1. Add `src/lib/palettes/<brand>-colors.ts` and optional `<brand>-packs.ts`
2. Wire exports in `palettes/index.ts`
3. Extend UI brand selector only — do **not** bake brand logic into `pattern.ts`

---

## Naming Conventions

- Files: `kebab-case.ts` for multi-word modules (`mard-colors.ts`)
- Types: `PascalCase` exported from `types.ts` or co-located with usage
- Constants: `SCREAMING_SNAKE` for data tables (`MARD_COLORS`, `MARD_PACKS`)

---

## Examples

- Palette layering: `src/lib/palettes/resolve.ts`
- Pattern options contract: `src/lib/pattern.ts` → `PatternOptions`
- Workshop analyze: `src/lib/workshop/analyze.ts` → `analyzeWorkshopFile` / `analyzeWorkshopImageData`
