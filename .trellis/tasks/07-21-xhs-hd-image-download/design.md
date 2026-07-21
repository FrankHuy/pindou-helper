# Design: XHS HD image download (bare original + optional JPG)

## Summary

Align Worker image selection with the finalized HD script: prefer **bare** `sns-img-bd` URLs from `fileId`/extracted tokens. Expose both original and optional CDN-JPG proxy paths. UI uses a single global “兼容 JPG” toggle (default off).

## Boundaries

| In | Out |
|----|-----|
| `worker/xhs/parse.ts` token + URL builders | Login / cookies |
| `worker/xhs/handlers.ts` dual proxy paths | Server-side HEIC re-encode |
| `worker/xhs/proxy.ts` magic-byte validation | Per-image dual save buttons |
| `worker/xhs/types.ts` + frontend types | Video notes |
| `src/features/xhs/*` toggle + save/preview path | ZIP / batch archive |
| `scripts/xhs_image_demo.py` + `xhs-download.md` | Changing allowlist hosts (already `*.xhscdn.com`) |

## Image URL strategy

```
resolveToken(image):
  if valid bare fileId → fileId
  else for each candidate URL in (infoList urls by scene, urlDefault, url, urlPre):
    token = extractFileId(url)  // strip !suffix; webpic skip 2 path segments
    if token valid → return token
  return null

originalUrl(token) = https://sns-img-bd.xhscdn.com/{token}          // no query
jpgUrl(token)      = https://sns-img-bd.xhscdn.com/{token}?imageView2/2/w/0/format/jpg

resolveImageSourceUrl(image):
  token = resolveToken(image)
  if token → originalUrl(token)
  else → highestImageUrl(image)  // page-provided, may include !suffix

// handlers per image:
  original = resolveImageSourceUrl(image) → normalize → proxyPath
  if token:
    jpg = jpgUrl(token) → normalize → proxyPathJpg (omit if normalize fails)
  else if original looks already jpg-friendly:
    proxyPathJpg optional omit (UI falls back to proxyPath)
```

### Token validation

- Prefer opaque tokens: reject empty, whitespace, `?`, `#`.
- **Relax path rule vs current `FILE_ID_RE`**: page `fileId` is usually `[A-Za-z0-9_-]+`, but extracted tokens from non-webpic hosts may be a single path segment of the same charset. Do **not** allow multi-segment path injection (`/` only if we explicitly decide to allow CDN multi-segment tokens — default **reject `/`** like today unless script tokens need it).
- Script note: webpic paths are `/{ts}/{hash}/{fileId}!suffix` → fileId is last segment before `!`. Non-webpic: path after host is the token (often equals `fileId`).
- URL-encode path segment when building CDN URL (`encodeURIComponent`).

### Host choice

- Default host: **`sns-img-bd.xhscdn.com`** (matches script + competitor byte sizes).
- Allowlist already covers `*.xhscdn.com`. No allowlist change required.
- Drop default `sns-img-hw` + forced jpg as primary.

### Fallback order (no token)

Keep scene preference close to page quality derivatives:

`WB_DFT` → `WB_ORI` → `WB_HQ` → `WB_PRV` → `urlDefault` / `url` / `urlPre`

(Add `WB_HQ` vs current code which skips it.)

## API contract changes

### `POST /api/xhs/parse` success image item

```ts
{
  index: number
  width: number
  height: number
  proxyPath: string          // original (bare when possible)
  proxyPathJpg?: string      // optional CDN jpg of same token
}
```

- Both paths always start with `/api/xhs/image?u=`.
- UI never receives raw CDN URLs.
- Backward compatible: old clients ignore `proxyPathJpg`.

### `GET /api/xhs/image?u=`

- Unchanged query shape.
- Validation change: if `Content-Type` is not `image/*`, read a small prefix (or full body if already buffered) and accept known image signatures (JPEG/PNG/WEBP/AVIF/HEIC/HEIF). Set outbound `Content-Type` from signature when upstream is wrong/`octet-stream`.
- Keep SSRF redirect allowlist behavior.

## Frontend

- Extend `XhsImageItem` with optional `proxyPathJpg`.
- Global state: `preferJpg: boolean` default `false` (session-local; no need for persistence in MVP).
- Toggle control near result header:「兼容 JPG（便于预览/部分设备保存）」.
- Active display/save path: `preferJpg && image.proxyPathJpg ? image.proxyPathJpg : image.proxyPath`.
- `saveImage`: map `image/heic` / `image/heif` → `.heic`; keep jpeg/png/webp/gif; if type missing, sniff blob or default `jpg` only for jpg path.
- Lightbox `<img>` uses active path (HEIC may fail to display in some browsers when toggle off — acceptable; copy already says long-press/save).

## Offline demo

Port core of finalized script into `scripts/xhs_image_demo.py`:

- `fileId` / extract token → `sns-img-bd` bare
- optional CLI flag `--jpg` to append imageView2
- content-type / magic-byte tolerance for download

Parity target: same primary URL construction as Worker (not full yaml fallback complexity unless needed).

## Security

- No cookies / no login bypass.
- Token path injection: reject `/ ? #` space; encodeURIComponent.
- Image proxy still HTTPS + host allowlist per hop.
- Do not open-proxy non-XHS hosts.

## Tradeoffs

| Choice | Rationale |
|--------|-----------|
| `sns-img-bd` over `hw` | Script + competitor size match |
| Optional jpg via CDN not WB_DFT | Preserves higher-res jpg than 1080 web derivative |
| Dual paths in JSON | Clean contract; toggle is pure client |
| Magic bytes in proxy | Bare original often `octet-stream` / HEIC |
| No local HEIC decode | Worker CPU/size; CDN already offers format param |

## Compatibility / rollout

- Deploy Worker + frontend together preferred so toggle has `proxyPathJpg`.
- If only Worker ships first: clients still get better bare originals on `proxyPath` alone (behavior change: may show HEIC failures in `<img>` until FE ships). Acceptable if co-deployed via same SPA assets binding.
- Rollback: revert parse URL builder to previous `format/jpg` primary if CDN bare URLs regress.

## Test focus

1. Unit-style pure functions: `extractFileId`, `isValidFileId`, `originalUrl`/`jpgUrl`, `resolveImageSourceUrl` with fixtures (fileId, webpic with `!`, no fileId).
2. Proxy: synthetic HEIC/octet-stream body accepted; non-image body still 502.
3. Parse payload includes `proxyPath` without `imageView2` and `proxyPathJpg` with it when token present.
4. Frontend type guard accepts optional `proxyPathJpg`.
5. Manual: sample note — original size ≫ WB_DFT; jpg toggle downloads jpeg.
