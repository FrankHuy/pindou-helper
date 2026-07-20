# Research: XHS original image CDN via fileId

Date: 2026-07-20  
Sample note: `6a58ee61000000000f016925`  
fileId: `1040g2sg322mhfpagn0004becoqbja980hfkbaoo`

## Public page payload

- `image.width` / `image.height` = 1948 × 2560
- `infoList`: only `WB_PRV`, `WB_DFT` on `sns-webpic-*.xhscdn.com` with `!nd_*` processing suffixes
- No `WB_ORI` in this sample
- Rewriting webpic bang suffixes or stripping them → 403/404

## Competitor-style URL (user-provided, verified)

```
https://sns-img-hw.xhscdn.com/{fileId}?imageView2/2/w/0/format/jpg
```

Verified with UA + `Referer: https://www.xiaohongshu.com/`:

| URL | Status | Size | Dims / type |
|-----|--------|------|-------------|
| `sns-img-hw.../{fileId}?imageView2/2/w/0/format/jpg` | 200 | 568461 | 1948×2560 jpeg |
| `sns-img-qc...` same path/query | 200 | 568461 | 1948×2560 jpeg |
| `sns-img-bd...` same | 200 | 568461 | 1948×2560 jpeg |
| `sns-img-hw.../{fileId}` (no query) | 200 | 466190 | image/heic |
| webpic host + imageView2 on fileId only | 403 | — | — |

## Implication

- Prefer constructing `sns-img-*` URL from `fileId` when present
- Keep `format/jpg` (or webp if product wants) for browser-friendly download
- `w/0` appears to mean no width cap (full pixels)
- Allowlist must include `sns-img-*.xhscdn.com` (already covered by `*.xhscdn.com` if present)
- Fallback chain: original construct → existing highestImageUrl(WB_*) 

## Open risks

- Some notes may lack `fileId` or img CDN may 403 without extra tokens later
- Multi-region host choice (hw/qc/bd) stability unknown
- HEIC without format conversion may break some mobile save flows → prefer `format/jpg`
