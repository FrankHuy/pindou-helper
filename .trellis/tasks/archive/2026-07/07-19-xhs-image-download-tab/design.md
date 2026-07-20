# Technical Design — 小红书高清图下载 Tab

## Overview

Add an independent top-level Tab and a Cloudflare Worker API that ports `scripts/xhs_image_demo.py` to TypeScript. Frontend only talks to same-origin `/api/*`; Worker fetches XHS HTML/images server-side with proper UA/Referer.

No new runtime npm deps for core parse/proxy if avoidable. ZIP out of scope.

## Architecture

```
[Browser React Tab]
   | POST /api/xhs/parse { url }
   v
[Worker: parseNote]
   - validate host allowlist
   - fetch share page (follow redirects)
   - extract window.__INITIAL_STATE__
   - find note with imageList
   - map highest_image_url per image
   - return { title, images: [{ index, width?, height?, proxyUrl, scene }] }
   |
   | GET /api/xhs/image?u=<encoded-cdn-url>
   v
[Worker: proxyImage]
   - allowlist CDN host
   - fetch with Referer: https://www.xiaohongshu.com/
   - stream bytes + content-type back to browser
```

Static SPA assets continue to be served by Cloudflare assets; Worker handles API routes first.

## Worker entry & wrangler

Current `wrangler.jsonc` is assets-only SPA. Extend to Worker + assets:

```jsonc
{
  "name": "pindou-helper",
  "main": "worker/index.ts",          // or path agreed in implement
  "compatibility_date": "2026-07-16",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "observability": { "enabled": true }
}
```

- Vite already uses `@cloudflare/vite-plugin` → local `npm run dev` / `preview` should run Worker + frontend together once `main` is set.
- Exact key names (`run_worker_first` array vs boolean) must match installed wrangler schema during implement; adjust if plugin expects alternate layout.

### Routing

```ts
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/xhs/parse' && request.method === 'POST') return parseNote(request)
    if (url.pathname === '/api/xhs/image' && request.method === 'GET') return proxyImage(request)
    // assets / SPA fallback handled by platform when not matched
    return env.ASSETS.fetch(request) // if binding present; else 404
  }
}
```

Implement agent should follow Cloudflare Vite plugin’s current Worker+assets pattern if `env.ASSETS` shape differs.

## Port of Python demo (TS modules)

Prefer pure functions under `worker/xhs/` (or `src/worker/…` if plugin requires colocation):

| Python | TS |
|--------|----|
| `state_from_page` | regex `__INITIAL_STATE__` + replace `:undefined` → `null` + `JSON.parse` + html unescape |
| `find_note` | recursive walk for object with non-empty `imageList` |
| `highest_image_url` | same scene preference order |
| `extension` | content-type map for download filename |

### URL allowlists

**Share page hosts** (parse input after URL extract):

- `www.xiaohongshu.com`, `xiaohongshu.com`
- `xhslink.com`, `www.xhslink.com`
- other known XHS short-link hosts only if demo/real traffic needs them

Reject arbitrary hosts (SSRF guard).

**Image CDN hosts** (proxy):

- Allow common XHS CDN patterns observed from demo responses (e.g. `*.xhscdn.com`, `*.xiaohongshu.com` image hosts).
- Reject non-allowlisted hosts; force `https`.

### Response contracts

**POST `/api/xhs/parse`**

Request:

```json
{ "url": "https://www.xiaohongshu.com/..." }
```

Also accept raw clipboard text; server or client extracts first URL (client preferred for simpler API).

Success `200`:

```json
{
  "title": "string",
  "resolvedUrl": "https://...",
  "images": [
    {
      "index": 1,
      "width": 0,
      "height": 0,
      "proxyPath": "/api/xhs/image?u=..."
    }
  ]
}
```

Errors `4xx/5xx` JSON:

```json
{ "error": "invalid_url" | "login_required" | "not_image_note" | "parse_failed" | "upstream_failed", "message": "中文说明" }
```

Heuristics:

- missing `__INITIAL_STATE__` → often login wall / unavailable → `login_required` or `parse_failed`
- state found but no `imageList` → `not_image_note` (video-only etc.)

**GET `/api/xhs/image?u=`**

- Decode, validate allowlist, fetch with UA + Referer
- Pass through status/body; set cache headers modestly (optional short `Cache-Control`)
- CORS not required for same-origin

## Frontend structure

Keep bead flow intact; introduce shell-level tab state.

### Suggested split (minimize risk)

```
src/
  App.tsx                 → thin shell: tab switch + mount panels
  features/
    bead/BeadApp.tsx      → move current App body (or keep inline if move is too large)
    xhs/XhsDownloadTab.tsx
    xhs/xhsApi.ts         → fetch parse + save helpers
  App.css                 → add tab + xhs styles (or xhs.css imported)
worker/
  index.ts
  xhs/parse.ts
  xhs/proxy.ts
  xhs/types.ts
```

If moving entire bead UI is high-churn, acceptable MVP: keep bead JSX in `App.tsx` behind `activeTab === 'bead'` and only extract XHS into `XhsDownloadTab.tsx`. Prefer extraction only if file size forces it.

### UI states (XHS tab)

1. Idle: URL input + 解析 button + compliance note
2. Loading: disabled input/button, spinner text
3. Success: title, count, thumbnail grid
4. Lightbox: large image (src = proxyPath), 保存图片 button, copy:「也可长按图片，用系统菜单保存」
5. Error: message + 重试

Lightbox: prev/next if R10 in scope for MVP (recommended yes — low cost).

### Save button behavior

```ts
async function saveImage(proxyPath: string, filename: string) {
  const res = await fetch(proxyPath)
  const blob = await res.blob()
  const obj = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = obj
  a.download = filename // e.g. xhs-01.jpg
  a.click()
  URL.revokeObjectURL(obj)
}
```

Long-press works because `<img src={proxyPath}>` is same-origin image.

### Tab state isolation

```ts
type AppTab = 'bead' | 'xhs'
const [tab, setTab] = useState<AppTab>('bead')
```

- Bead state remains in Bead tree (existing hooks/state)
- XHS state only in `XhsDownloadTab`
- Switching tabs uses CSS hide or conditional render that **keeps mounted** if we need state retention — prefer keep-mounted (`hidden`/`display`) for bead heavy state; XHS can remount or stay.

Header:

- Brand title can stay global or change subtitle per tab
- Upload button only on bead tab

## Security & abuse

- Host allowlists (SSRF)
- Optional: basic rate limit later (not MVP)
- No cookies stored; no user auth
- Do not log full image URLs in client analytics (none today)
- User-Agent string similar to demo Chrome UA

## Compatibility

- Existing bead-only static deploy becomes Worker+assets deploy — `npm run deploy` path must still work
- README privacy section: note that XHS tab sends **share URL** (not local photos) to our Worker which fetches Xiaohongshu; bead path remains local-only

## Trade-offs

| Choice | Why |
|--------|-----|
| Same-origin image proxy | CDN often blocks hotlink / CORS; Referer needed |
| No ZIP | Mobile UX per product decision |
| Regex parse of INITIAL_STATE | Matches proven demo; fragile if XHS changes — isolate module for easy fix |
| Tab not react-router | No router dep; two panels enough |

## Rollback

1. Remove Worker `main` / API routes; restore assets-only wrangler if needed
2. Remove XHS tab UI; bead shell back to single view
3. Keep `scripts/xhs_image_demo.py` unchanged as offline fallback
