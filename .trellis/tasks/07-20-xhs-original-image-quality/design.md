# Technical Design — XHS original image quality

## Overview

Upgrade the existing XHS Worker parse path so each note image prefers a **constructed original CDN URL from `fileId`**, instead of only the public-page `WB_DFT` webpic derivative (~1080). Fallback remains the current `infoList` strategy.

No new routes, no frontend contract break, no login/Cookie.

## Root cause (verified)

Public `__INITIAL_STATE__` exposes:

- `image.width` / `image.height` — original pixel metadata
- `image.fileId` — stable media id
- `infoList` — often only `WB_PRV` / `WB_DFT` on `sns-webpic-*.xhscdn.com` with `!nd_*` processing suffixes

Competitor-quality URL (verified 1948×2560 / ~568KB on sample note):

```text
https://sns-img-hw.xhscdn.com/{fileId}?imageView2/2/w/0/format/jpg
```

Also works: `sns-img-qc`, `sns-img-bd`.  
Bare `sns-img-hw/{fileId}` may return HEIC — prefer forced `format/jpg`.  
Rewriting webpic `!nd_dft` is not viable (403/404).

## Data flow

```
parseNote
  → findNote / imageList[]
  → for each image:
       if valid fileId:
         candidate = originalUrlFromFileId(fileId)  // sns-img-hw first
         if normalizeImageUrl(candidate) ok → use it
       else / if construct invalid:
         candidate = highestImageUrl(image)          // existing WB_* path
  → proxyPath = /api/xhs/image?u=<encoded>
  → browser save via existing proxy (Referer + allowlist)
```

Optional **host fallback at parse time** (Should R6):

1. Prefer `sns-img-hw` URL in `proxyPath` without probing (cheap, matches competitor).
2. If product later sees regional 403s, either:
   - probe HEAD/GET during parse (adds latency), or
   - teach proxy to retry alternate hosts on upstream failure.

**MVP choice**: construct **hw only** in parse; document qc/bd as follow-up if needed. Proxy already allowlists `*.xhscdn.com`, so qc/bd work if we switch host string.

## Module changes

| File | Change |
|------|--------|
| `worker/xhs/types.ts` | `NoteImage.fileId?: string` |
| `worker/xhs/parse.ts` | `isValidFileId`, `originalUrlFromFileId`, `resolveImageSourceUrl` (fileId first, then `highestImageUrl`) |
| `worker/xhs/handlers.ts` | call `resolveImageSourceUrl` instead of only `highestImageUrl` |
| `worker/xhs/allowlist.ts` | no host rule change if `*.xhscdn.com` already allowed (confirm only) |
| Spec `xhs-download.md` | document fileId original priority |
| README (optional R7) | one line: prefer original when fileId present |

Frontend `XhsDownloadTab` / `xhsApi` **unchanged** if `proxyPath` shape stays the same.

## Contracts

### `originalUrlFromFileId(fileId: string, host = 'sns-img-hw.xhscdn.com'): string`

```ts
// fileId: non-empty, charset [A-Za-z0-9_-] or observed XHS id pattern; reject if contains / ? #
`https://${host}/${encodeURIComponent(fileId)}?imageView2/2/w/0/format/jpg`
```

Use path segment carefully: `fileId` from XHS is opaque alphanumeric; **reject** ids with `/`, `?`, `#`, spaces to avoid open path injection even inside allowlisted host.

### `resolveImageSourceUrl(image: NoteImage): string`

1. If `fileId` valid → `originalUrlFromFileId`
2. Else → `highestImageUrl(image)` (keep current WB order for fallback; optional later swap ORI before DFT only affects fallback)

### API response

Unchanged:

```json
{ "title", "resolvedUrl", "images": [{ "index", "width", "height", "proxyPath" }] }
```

`width`/`height` already come from note metadata (original dims) — good; they will now better match downloaded pixels when fileId path works.

### Proxy

No change required for MVP: `sns-img-hw.xhscdn.com` matches `*.xhscdn.com`.  
Still HTTPS-only + redirect allowlist.

## Security

- Do not accept caller-supplied fileId from client for arbitrary fetch beyond parse-produced proxyPath (existing model).
- fileId charset allowlist.
- No Cookie forwarding.
- SSRF: host still must pass `isAllowedImageHost`.

## Failure matrix

| Case | Behavior |
|------|----------|
| fileId present, img CDN 200 | original pixels via proxy |
| fileId present, img CDN 403/404 | user sees broken thumb/save fail **unless** we probe at parse — MVP: prefer also attaching fallback? |

**MVP parse strategy decision**:

- **Eager single URL**: put original URL in `proxyPath` only. If CDN fails at view/save time, user gets proxy error. Simple.
- **Safer**: at parse, optionally try fetch original with short timeout; on failure use webpic URL.

**Recommend Safer-lite for MVP without full download**: do **not** probe during parse (latency + workerd CPU). Original URL is known-good on sample; if save fails, user retries. Follow-up can add proxy multi-host retry.

If original construct invalid → fallback webpic in parse (no error).

## Compatibility / rollback

- Rollback: remove fileId branch; restore `highestImageUrl` only.
- Demo script optional update for offline parity (nice-to-have, not required for AC).

## Trade-offs

| Choice | Why |
|--------|-----|
| Construct URL vs reverse more APIs | User-provided + verified; minimal scope |
| Force `format/jpg` | Avoid HEIC save issues on some devices |
| No parse-time probe | Faster parse; rare CDN miss handled later |
| Keep WB_* as fallback | Notes without fileId still work |
