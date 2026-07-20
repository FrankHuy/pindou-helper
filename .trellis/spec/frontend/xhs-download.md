# Xiaohongshu Image Download (Worker + Tab)

> Cross-layer contracts for the independent “小红书下图” tab and same-origin Worker APIs.

---

## 1. Scope / Trigger

- Trigger: Worker-backed API + browser tab that parses public XHS share pages and proxies images.
- Layers: `src/features/xhs/*` (UI) ↔ Cloudflare Worker `worker/xhs/*` ↔ upstream XHS HTML/CDN.
- Privacy split: bead pipeline stays local-only; XHS tab sends only the **share URL** (never local photos / cookies).

---

## 2. Signatures

### Worker entry (`worker/index.ts`)

```ts
export default {
  async fetch(request: Request, env: { ASSETS: { fetch(req: Request): Promise<Response> } }): Promise<Response>
}
```

Routes:

| Method | Path | Handler |
|--------|------|---------|
| `POST` | `/api/xhs/parse` | `parseNote` |
| `GET` | `/api/xhs/image?u=` | `proxyImage` |
| any | other `/api/*` | JSON 404 |
| any | non-API | `env.ASSETS.fetch` (SPA) |

Wrangler: `main` + `assets.run_worker_first: ["/api/*"]` + `assets.binding: "ASSETS"`.

### Pure parse helpers (`worker/xhs/parse.ts`)

```ts
stateFromPage(page: string): unknown
findNote(state: unknown): NoteRecord
isValidFileId(fileId: unknown): fileId is string
originalUrlFromFileId(fileId: string, host?: string): string
resolveImageSourceUrl(image: NoteImage): string
highestImageUrl(image: NoteImage): string
```

Image source selection (`resolveImageSourceUrl`):

1. Valid `fileId` → original CDN  
   `https://sns-img-hw.xhscdn.com/{fileId}?imageView2/2/w/0/format/jpg`  
   (`fileId` must match `[A-Za-z0-9_-]+`; reject `/` `?` `#` spaces)
2. Else `highestImageUrl`: `WB_DFT` → `WB_ORI` → `WB_PRV` → `urlDefault` / `url` / `urlPre`

Public pages often only expose ~1080 `WB_DFT` webpic derivatives; `fileId` recovers near-original pixels when available. Force `format/jpg` (bare fileId may be HEIC).

### Frontend client (`src/features/xhs/xhsApi.ts`)

```ts
extractFirstUrl(text: string): string | null
parseXhsNote(input: string, signal?: AbortSignal, turnstileToken?: string): Promise<XhsParseResult>
saveImage(proxyPath: string, index: number): Promise<void>
```

---

## 3. Contracts

### `POST /api/xhs/parse`

Request:

```json
{
  "url": "string — share URL or free-form share text",
  "turnstileToken": "optional string — required when Worker has TURNSTILE_SECRET"
}
```

Turnstile (anti-abuse, **parse only**):

- `GET /api/config` returns `{ turnstileSiteKey, turnstileRequired }` from Worker runtime (`TURNSTILE_SITE_KEY` or `VITE_TURNSTILE_SITE_KEY`, plus whether `TURNSTILE_SECRET` is set).
- Frontend loads site key from `/api/config` (preferred) or build-time `VITE_TURNSTILE_SITE_KEY` fallback; renders widget; token sent as `turnstileToken`.
- Worker calls Cloudflare `siteverify` when `TURNSTILE_SECRET` is set; if secret unset, verification is skipped (local/dev).
- `/api/xhs/image` is **not** Turnstile-protected.

Success `200`:

```json
{
  "title": "string",
  "resolvedUrl": "https://…",
  "images": [
    {
      "index": 1,
      "width": 0,
      "height": 0,
      "proxyPath": "/api/xhs/image?u=<encoded https CDN url>"
    }
  ]
}
```

- Client and server both extract the first `http(s)` URL; strip trailing punctuation and CJK glued to the URL.
- Image list items always expose **same-origin** `proxyPath` (never raw CDN in UI).

### `GET /api/xhs/image?u=`

- `u`: absolute HTTPS image URL (allowlisted host).
- Success: stream image bytes + `Content-Type: image/*`, modest `Cache-Control`.
- Do **not** double-decode after `URLSearchParams.get` — signed CDN URLs may contain encoded characters.

### Allowlists (SSRF)

| Kind | Hosts |
|------|--------|
| Share parse input | exact: `xiaohongshu.com`, `www.xiaohongshu.com`, `xhslink.com`, `www.xhslink.com` |
| Share redirects | share hosts **or** `*.xiaohongshu.com`; http/https |
| Image proxy + redirects | HTTPS only; `*.xiaohongshu.com` / `xiaohongshu.com` / `*.xhscdn.com` / `xhscdn.com` |

Every redirect hop is validated (`fetchWithAllowedRedirects`, `redirect: 'manual'`).

### Environment

- No XHS login cookies.
- Optional Turnstile (Worker runtime preferred):
  - `TURNSTILE_SITE_KEY` (public site key; alias `VITE_TURNSTILE_SITE_KEY` also read at runtime)
  - `TURNSTILE_SECRET` (Worker secret)
  - Optional build fallback: `VITE_TURNSTILE_SITE_KEY` for local Vite-only
- Browser UA similar to demo Chrome UA; image fetch sets `Referer: https://www.xiaohongshu.com/`.

---

## 4. Validation & Error Matrix

JSON error shape: `{ "error": XhsErrorCode, "message": "中文说明" }`.

| Condition | HTTP | `error` | Typical message intent |
|-----------|------|---------|------------------------|
| Missing / non-JSON body / empty url | 400 | `invalid_url` | 请粘贴链接 / 请求体错误 |
| Host not allowlisted | 400 | `invalid_url` | 仅支持 xhs 域名 |
| Redirect hop off allowlist | 502 | `upstream_failed` | 重定向域名不受支持 |
| Upstream HTML non-OK | 502 / 404 | `upstream_failed` / `parse_failed` | 获取失败 / 不存在 |
| No `window.__INITIAL_STATE__` | 403 | `login_required` | 可能需登录或不存在 |
| State without `imageList` | 422 | `not_image_note` | 非图文 / 视频帖 |
| Images all unusable | 422 | `not_image_note` | 没有可下载图片 |
| Proxy missing `u` / bad host | 400 | `invalid_url` | 参数 / 域名 |
| Proxy non-image body | 502 | `upstream_failed` | 返回不是图片 |
| Turnstile missing/failed (secret configured) | 403 | `turnstile_failed` | 请完成人机验证 / 验证失败 |
| Unknown `/api/*` | 404 | `not_found` | 接口不存在 |

Frontend maps `!response.ok` → `Error(message)` and validates success payload shape before rendering.

---

## 5. Good / Base / Bad Cases

- **Good**: public note share URL → title + ≥1 `proxyPath` → lightbox save downloads `xhs-01.jpg` via blob.
- **Base**: paste share-card text containing URL + Chinese copy → extract first URL → same as Good or Chinese error + 重试.
- **Bad**: `https://example.com/…` parse or image proxy → 400 `invalid_url`; no open proxy.

---

## 6. Tests Required

Minimum gates:

1. `npm run build` / `npm run lint` clean for `src/` + `worker/` (ignore unrelated `.pi` warnings unless introduced by the task).
2. Allowlist unit-style checks: reject non-XHS share/image hosts; accept `*.xhscdn.com` (incl. `sns-img-hw.xhscdn.com`).
3. Parser: fixture HTML with `:undefined` + mixed `infoList` scenes → prefers `WB_DFT` when no fileId; with valid fileId → `sns-img-hw` original URL.
4. Manual / preview when workerd available: invalid URL, login-wall style missing state, bead tab regression; sample note with fileId downloads original-class dims (not only ~1080).

Assertion points:

- UI `img` / `saveImage` only use paths starting with `/api/xhs/image`.
- Bead workspace stays mounted (`is-hidden`) when switching tabs so generation state is preserved.
- No ZIP / cookie / login-bypass code paths.
- Invalid fileId (path chars) never becomes a CDN path segment.

---

## 7. Wrong vs Correct

#### Wrong

```ts
// Hotlink CDN from the browser (CORS / Referer / SSRF risk)
<img src={cdnUrl} />
await fetch(cdnUrl)
// Auto-follow redirects without host checks
await fetch(shareUrl) // redirect: 'follow' by default
```

#### Correct

```ts
// Same-origin proxy only
<img src={image.proxyPath} />
await saveImage(image.proxyPath, image.index)
// Manual redirects + allowlist each hop
await fetchWithAllowedRedirects(url, init, isAllowedShareTarget)
```

---

## UI conventions

- Top-level tabs: `bead` | `xhs` in `App.tsx`; upload control only on bead.
- XHS states: idle → loading (disable submit) → success grid / error+retry.
- Lightbox: explicit **保存图片** + copy「也可长按图片，用系统菜单保存」; prev/next + keyboard arrows.
- Abort in-flight parse on remount / superseding request (generation token + `AbortController`).

## Offline reference

`scripts/xhs_image_demo.py` remains the offline parity reference; production runtime is Worker TypeScript only.
