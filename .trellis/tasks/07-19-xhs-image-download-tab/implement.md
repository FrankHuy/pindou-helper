# Implementation Plan — 小红书高清图下载 Tab

## Checklist

### 1. Worker foundation
- [ ] 1.1 Confirm Cloudflare Vite plugin Worker+assets layout against installed docs/schema
- [ ] 1.2 Add `worker/index.ts` entry; wire `wrangler.jsonc` (`main`, `assets.run_worker_first` for `/api/*`)
- [ ] 1.3 Health/routing smoke: unmatched `/api/*` → JSON 404; non-API still serves SPA

### 2. XHS parse + proxy (port demo)
- [ ] 2.1 `stateFromPage` / `findNote` / `highestImageUrl` pure functions + unit-style fixtures if easy
- [ ] 2.2 `POST /api/xhs/parse` with host allowlist, redirect follow, Chinese error mapping
- [ ] 2.3 `GET /api/xhs/image` CDN allowlist + Referer + stream body
- [ ] 2.4 Manual curl against a public share URL in `wrangler dev` / `npm run preview`

### 3. Frontend shell + XHS tab
- [ ] 3.1 App-level `tab`: `bead` | `xhs`; header switch; upload control only on bead
- [ ] 3.2 `XhsDownloadTab`: input, parse, loading, error+retry, title+grid
- [ ] 3.3 Lightbox: full image via proxy, 保存图片, 长按提示文案, prev/next
- [ ] 3.4 `saveImage` via blob download; filename `xhs-{index}.{ext}`
- [ ] 3.5 Compliance short note under input
- [ ] 3.6 CSS for tabs, grid, lightbox (mobile-first)

### 4. Docs / privacy copy
- [ ] 4.1 README: mention XHS tab + Worker fetches share URL (bead still local-only)

### 5. Validate
- [ ] 5.1 `npm run build`
- [ ] 5.2 `npm run lint`
- [ ] 5.3 Manual: public note parse → preview → save one image on mobile-width viewport
- [ ] 5.4 Manual: invalid URL / non-image note error paths
- [ ] 5.5 Manual: bead tab still generates/exports

## Validation commands

```bash
npm run build
npm run lint
npm run preview   # or wrangler dev via plugin
```

## Review gates

- SSRF: parse and proxy reject non-allowlisted hosts
- Bead tab isolation: no shared destructive state with XHS
- Save path uses proxy, not raw CDN, in UI `img`/`fetch`
- No ZIP code paths
- Error messages in Chinese and actionable

## Risky files / rollback points

| Area | Files | Rollback |
|------|-------|----------|
| Deploy shape | `wrangler.jsonc`, `vite.config.ts`, `worker/*` | Revert to assets-only config |
| UI shell | `src/App.tsx`, `src/App.css` | Remove tab wrapper |
| Feature | `src/features/xhs/*` | Delete folder |

## Order notes

1. Worker parse/proxy first (can curl without UI)
2. Then XHS tab UI against real API
3. Then shell tab integration + bead regression check
