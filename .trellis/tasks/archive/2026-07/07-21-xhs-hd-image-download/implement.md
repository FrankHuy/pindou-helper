# Implement: XHS HD image download

## Checklist

### 1. Parse / URL builders (`worker/xhs/parse.ts`, `types.ts`)

- [x] 1.1 Change `originalUrlFromFileId` (or rename) to bare `https://sns-img-bd.xhscdn.com/{token}` (no `imageView2`)
- [x] 1.2 Add `jpgUrlFromFileId(token)` → same host + `?imageView2/2/w/0/format/jpg`
- [x] 1.3 Add `extractFileIdFromUrl(url)` (webpic skip 2 segments; strip `!suffix`; normalize `//` / http→https)
- [x] 1.4 Add `resolveToken(image)`: valid `fileId` first, else scan infoList/top-level URLs
- [x] 1.5 Update `resolveImageSourceUrl` to token bare URL else `highestImageUrl`
- [x] 1.6 Add `WB_HQ` into `highestImageUrl` scene order after `WB_ORI`
- [x] 1.7 Keep `isValidFileId` injection guards; host constant `sns-img-bd.xhscdn.com`

### 2. Parse handler (`worker/xhs/handlers.ts`, `types.ts`)

- [x] 2.1 Extend `XhsImageItem` with optional `proxyPathJpg?: string`
- [x] 2.2 For each image: build original proxy path; if token present, build jpg proxy path
- [x] 2.3 Keep candidate fallback to page URL when original normalize fails
- [x] 2.4 Ensure raw CDN never leaks outside `u=` query

### 3. Image proxy (`worker/xhs/proxy.ts`)

- [x] 3.1 If content-type not `image/*`, sniff magic bytes (jpeg/png/webp/avif/heic/heif)
- [x] 3.2 Accept body when signature matches; set corrected `Content-Type`
- [x] 3.3 Reject unknown signatures as today (502)
- [x] 3.4 Prefer streaming when type is already `image/*`; buffer only when sniffing needed (or always buffer small — document choice)

### 4. Frontend (`src/features/xhs/*`)

- [x] 4.1 Types + `isXhsParseResult` allow optional `proxyPathJpg` (must still start with `/api/xhs/image`)
- [x] 4.2 Global `preferJpg` toggle in result UI (default false)
- [x] 4.3 Thumbnails / lightbox / save use active path helper
- [x] 4.4 `saveImage` extensions: heic/heif + existing types
- [x] 4.5 Minimal CSS for toggle

### 5. Offline demo + spec

- [x] 5.1 Update `scripts/xhs_image_demo.py` to bare `sns-img-bd` + optional `--jpg`
- [x] 5.2 Update `.trellis/spec/frontend/xhs-download.md` (selection order, dual paths, proxy sniffing, toggle)

### 6. Validate

- [x] 6.1 `npm run lint` / `npm run build`
- [x] 6.2 Pure function checks / fixtures for token extract + URL builders
- [x] 6.3 Sample CDN check: bare `sns-img-bd/{fileId}` → HEIC/octet-stream ~466KB; same token + imageView2 jpg → jpeg 1948×2560 ~568KB; pure token/URL/sniff fixtures pass

## Validation commands

```bash
npm run lint
npm run build
# optional offline:
# python3 scripts/xhs_image_demo.py '<share-url>' /tmp/xhs_hd
# python3 scripts/xhs_image_demo.py '<share-url>' /tmp/xhs_jpg --jpg
```

## Review gates

- Default path has **no** `imageView2` and **no** `!nd_` when token exists
- JPG path is **not** WB_DFT webpic
- Proxy does not 502 true HEIC/octet-stream images
- Toggle default off; on uses `proxyPathJpg` when present
- Spec matches code

## Rollback points

1. After parse-only change: revert URL builder if CDN bare fails widely
2. After proxy sniff: revert to image/* only if false positives
3. After FE toggle: hide toggle / ignore `proxyPathJpg` if UX issues

## Out of implement scope

- LocalStorage for toggle persistence
- Per-image format buttons
- pillow-heif / dimension reporting in Worker
