# Implementation Plan — XHS original image quality

## Checklist

### 1. Types + pure URL resolve
- [ ] 1.1 Add `fileId?: string` to `NoteImage` in `worker/xhs/types.ts`
- [ ] 1.2 Add `isValidFileId` + `originalUrlFromFileId` in `worker/xhs/parse.ts` (or small `original.ts` if cleaner)
- [ ] 1.3 Add `resolveImageSourceUrl(image)`: valid fileId → sns-img-hw original; else `highestImageUrl`
- [ ] 1.4 Keep fallback `highestImageUrl` behavior for notes without fileId

### 2. Wire parse handler
- [ ] 2.1 `handlers.ts` uses `resolveImageSourceUrl` when mapping `imageList`
- [ ] 2.2 Confirm `normalizeImageUrl` accepts constructed URL (`*.xhscdn.com` already allowed)
- [ ] 2.3 Skip image only if both original construct and fallback fail

### 3. Spec / docs
- [ ] 3.1 Update `.trellis/spec/frontend/xhs-download.md` image selection priority (fileId original first)
- [ ] 3.2 Optional README one-liner (R7)

### 4. Validate
- [ ] 4.1 `npm run build` / `npm run lint`
- [ ] 4.2 Against sample note `6a58ee61000000000f016925` (when network/workerd available): parse `proxyPath` host is `sns-img-hw` + query `imageView2`; proxied image ~1948×2560 / ~568KB class
- [ ] 4.3 Invalid host still rejected; bead tab smoke unchanged

## Validation commands

```bash
npm run build
npm run lint
# Prefer node/curl probe of constructed URL if wrangler dev blocked by GLIBC:
# curl -A 'Chrome…' -H 'Referer: https://www.xiaohongshu.com/' \
#   'https://sns-img-hw.xhscdn.com/{fileId}?imageView2/2/w/0/format/jpg' -o /tmp/o.jpg
```

## Review gates

- fileId rejected if contains `/` `?` `#` or empty
- UI still only uses `/api/xhs/image?u=…`
- No Cookie / login paths
- Fallback path still works without fileId

## Risky files / rollback

| Area | Files | Rollback |
|------|-------|----------|
| Resolve logic | `worker/xhs/parse.ts`, `types.ts`, `handlers.ts` | Revert to `highestImageUrl` only |
| Spec | `xhs-download.md` | Revert priority section |

## Order

1. Pure helpers + types  
2. Handler wire  
3. Spec  
4. build/lint + sample URL probe  
