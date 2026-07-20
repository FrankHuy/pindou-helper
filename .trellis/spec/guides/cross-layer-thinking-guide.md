# Cross-Layer Thinking Guide

> Ask these questions before changing code that crosses SPA ↔ Worker ↔ pure lib boundaries.

---

## Layers in this repo

```
Browser UI (App / features/*)
    │ local File / Canvas          │ fetch /api/*
    ▼                              ▼
src/lib/* (pure algorithms)    worker/* (Cloudflare)
    │                              │
    └──────── no React ────────────┴── allowlists / secrets
```

| Boundary | Risk |
|----------|------|
| UI ↔ `src/lib` | Passing React state into pure functions; duplicating color math |
| UI ↔ Worker | JSON field drift; error code/message mismatch; leaking secrets |
| Worker ↔ upstream XHS | SSRF via redirects; wrong image URL tier |
| Privacy copy ↔ real product | Privacy page **must not** document XHS even though XHS tab exists |

---

## Checklist before implementing

### 1. Map the data flow

```
User input → validate at edge → transform → display / persist
```

Examples:

- Bead: `File` → `createPattern` → `BeadPattern` → canvas / export PNG (never server)
- Workshop: `File` → `ImageData` → `analyzeWorkshopImageData` → highlight (never server)
- XHS: share text → `POST /api/xhs/parse` → `proxyPath[]` → `GET /api/xhs/image` → blob save

### 2. Name the contract owner

| Data | Single owner |
|------|----------------|
| Palette distance | `src/lib/color-match.ts` |
| Active color set | `resolvePalette` |
| XHS error shape | Worker JSON + `xhs-download.md` matrix |
| Turnstile site key | Worker `/api/config` (not only Vite define) |
| Turnstile secret | Worker env only |

### 3. Validate once at the right edge

- Share URL host: Worker **and** light client extract — Worker is authoritative
- Image proxy URL: every redirect hop on Worker
- Empty palette: throw in `createPattern` + UI message
- Turnstile: Worker when secret set; UI should still require token when site key present

---

## Common mistakes here

| Mistake | Instead |
|---------|---------|
| Hotlink `xhscdn` from `<img>` | Only `proxyPath` |
| Put parse HTML logic in the React tab | Keep in `worker/xhs/parse.ts` |
| Import Worker types into Vite app (or reverse) | Document JSON; duplicate minimal client types in `xhsApi.ts` |
| Change legend export layout without workshop heuristics note | Update `workshop.md` + test own-tool PNG path |
| Assume `VITE_*` always exists on CF Git deploy | Runtime `/api/config` |

---

## When to open which spec

- Palette / generate → `type-safety.md`, `quality-guidelines.md`
- Workshop → `workshop.md`
- XHS / Turnstile → `xhs-download.md`
- Tabs / shell → `component-guidelines.md`
