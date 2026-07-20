# Technical Design — Privacy / About / Turnstile

## Overview

Add two static info surfaces (Privacy Policy, About + tip QR + email) and protect **only** `POST /api/xhs/parse` with Cloudflare Turnstile siteverify. Image proxy stays unchanged (allowlist only).

Privacy copy is **bead-tool only** — no Xiaohongshu / share-link / third-party fetch language (product decision).

## Architecture

```
[App shell]
  tabs: bead | xhs
  footer → Privacy | About
  path /privacy | /about → full-page info views (SPA)

[XhsDownloadTab]
  Turnstile widget (site key from import.meta.env)
  parseXhsNote(url, { turnstileToken })
       │
       v
POST /api/xhs/parse { url, turnstileToken }
       │
       v
[Worker parseNote]
  if TURNSTILE_SECRET set → siteverify token
  else (dev) → allow with documented bypass
  then existing parse pipeline
```

## Routing (no react-router)

**Choice**: path-based views with History API, zero new deps.

| Path | View |
|------|------|
| `/` (default) | existing tab shell |
| `/privacy` | Privacy page |
| `/about` | About page |

- On load: read `location.pathname` → set `shellPage: 'app' | 'privacy' | 'about'`
- Footer / links: `history.pushState` + state update; listen `popstate`
- Cloudflare assets already `not_found_handling: single-page-application` → deep links work
- Bead workspace stays mounted when on info pages **or** hide entire shell — prefer render info page instead of tabs (simpler); bead state preserved if we keep App mounted and only swap main content while keeping bead section mounted hidden when leaving to privacy/about from bead…  
  **MVP**: when `shellPage !== 'app'`, render only info layout (header back + content). Unmounting XHS tab is OK; bead section can stay mounted-hidden to preserve generate state if user navigates Privacy from bead.

Recommended structure in `App.tsx`:

```ts
type ShellPage = 'app' | 'privacy' | 'about'
```

## Privacy content (constraints)

- Title: 隐私政策 / Privacy Policy  
- Sections (Chinese UI consistent with app): 我们是谁、本地处理、不上传原图、PWA/本地存储（如有）、联系邮箱  
- **Forbidden strings** in this page: 小红书, xhs, xhslink, xiaohongshu, 分享链接下载, Worker 代拉 等  
- Optional: do not claim “no network at all” if inaccurate for future — stick to “拼豆图纸在本地处理，不会上传你的本地照片”

## About content

- Short product blurb: 拼豆图纸助手  
- Email: `Frank@Frankiehu.top` (`mailto:` + visible text)  
- Tip block: heading/旁文案 **请作者喝一杯咖啡**  
- Two QR images side by side, **no** 微信/支付宝 labels  
- Assets:

```
public/tip/qr-a.jpg   # from pics/微信图片_20260720173154_324_2.jpg
public/tip/qr-b.jpg   # from pics/微信图片_20260720173155_325_2.jpg
```

Copy files at implement time (stable ASCII names). Keep `pics/` as source or only public — prefer copy into `public/tip/` for deploy.

## Turnstile

### Scope

- **Only** `POST /api/xhs/parse`
- `/api/xhs/image` unprotected by Turnstile (R decision A)

### Frontend

- Load Turnstile script (`https://challenges.cloudflare.com/turnstile/v0/api.js`) when XHS tab mounts (or once globally)
- Widget above/near 解析 button; managed mode
- Site key: `import.meta.env.VITE_TURNSTILE_SITE_KEY` (public)
- On parse: require non-empty token; send JSON field `turnstileToken`
- On success/error: reset widget (`turnstile.reset`) so token is single-use friendly
- Chinese errors if missing token / server rejects

### Worker

```ts
// Env
TURNSTILE_SECRET?: string  // wrangler secret
// optional: TURNSTILE_REQUIRED=true for prod strictness
```

Flow in `parseNote` **before** upstream fetch:

1. Read `turnstileToken` from body (string)
2. If `!env.TURNSTILE_SECRET`:  
   - **Dev bypass**: proceed (document in README); optional warn header  
   - Do not ship secret in repo
3. If secret set and token missing/empty → `403` `{ error: 'turnstile_failed', message: '请完成人机验证' }`
4. POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`  
   `secret`, `response` (token), optional `remoteip`
5. If `success !== true` → same Chinese error  
6. Else continue existing parse

Extend `XhsErrorCode` with `turnstile_failed`.

### Types / handler signature

Worker `fetch` must pass `env` into `parseNote(request, env)`.

### Local / CI

- Without keys: parse still works (bypass) so `npm run build` and local bead/xhs UI don’t hard-fail  
- README: how to create Turnstile widget, set `VITE_TURNSTILE_SITE_KEY`, `wrangler secret put TURNSTILE_SECRET`

## UI entry points

- Sticky or bottom **footer** on app shell: `隐私政策` · `关于`  
- Info pages: top **返回** → `/` app shell  
- Mobile-friendly QR: max-width ~160–200px, gap, wrap

## Security / privacy notes

- Secret only on Worker; never in client bundle  
- Turnstile token is single-purpose; always reset after parse attempt  
- Privacy page omission of XHS is intentional product text, not a security control — real network behavior of XHS tab unchanged

## Compatibility / rollback

- Remove Turnstile check + widget → previous parse behavior  
- Remove pages/footer → no impact on generate  
- QR files only in `public/tip/`

## Trade-offs

| Choice | Why |
|--------|-----|
| Parse-only Turnstile | Stops bulk upstream HTML fetch; multi-image proxy stays smooth |
| Path routing without router | Shareable /privacy; SPA fallback already configured |
| Unlabeled QR | User request |
| Dev bypass without secret | Keeps OSS/dev usable |
