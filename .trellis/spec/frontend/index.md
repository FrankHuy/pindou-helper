# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

Vite + React + TypeScript PWA: local image → MARD bead pattern conversion, plus an optional Worker-backed Xiaohongshu public-image download tab.
Bead domain logic in `src/lib/`; bead UI orchestration in `src/App.tsx`; XHS feature in `src/features/xhs/` + `worker/`.

---

## Pre-Development Checklist

Before changing generation or palette code, read:

1. [Directory Structure](./directory-structure.md) — where palette / pattern modules live
2. [Type Safety](./type-safety.md) — `resolvePalette` + `PatternOptions` contracts
3. [State Management](./state-management.md) — debounce + latest-ref regenerate pattern
4. [Quality Guidelines](./quality-guidelines.md) — forbidden pack/slice and MVP-palette rules

Before changing XHS download / Worker APIs, also read:

5. [XHS Download](./xhs-download.md) — parse/proxy contracts, allowlists, error matrix

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, regenerate orchestration | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Palette / pattern contracts | Filled |
| [XHS Download](./xhs-download.md) | Worker parse/proxy + tab contracts | Filled |

---

## Design Decisions (palette quality controls)

1. **Real MARD 291 only** — discarded conflicting 33-color MVP table.
2. **Layered palette** — merchant pack overrides range; series filter and disabled are orthogonal filters.
3. **Exact pack codes** — never derive packs by `slice(0, N)`.
4. **Median-cut then map to palette** — final colors always bead codes; count ≤ maxColors.
5. **No new runtime deps** for quantization / adjustments.

## Design Decisions (XHS tab)

1. **Same-origin image proxy** — UI never hotlinks XHS CDN; Worker adds Referer + host allowlists.
2. **Tab isolation** — bead workspace stays mounted when hidden; XHS state lives in `XhsDownloadTab` only.
3. **No ZIP / login bypass** — per-image save only; public posts only.

---

**Language**: All documentation should be written in **English**.
