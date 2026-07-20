# Implementation Plan — Privacy / About / Turnstile

## Checklist

### 1. Static assets + info pages
- [ ] 1.1 Copy tip QR images to `public/tip/qr-a.jpg` and `public/tip/qr-b.jpg` (from `pics/…`)
- [ ] 1.2 Add `src/features/info/PrivacyPage.tsx` — bead-only policy, no XHS wording
- [ ] 1.3 Add `src/features/info/AboutPage.tsx` — blurb, email, tip copy + two QRs unlabeled
- [ ] 1.4 Styles for info pages + footer (mobile)

### 2. App shell routing + entry
- [ ] 2.1 `ShellPage` state + pathname sync (`/`, `/privacy`, `/about`)
- [ ] 2.2 Footer links; back control on info pages
- [ ] 2.3 Preserve bead mount strategy when navigating away if feasible

### 3. Turnstile on parse only
- [ ] 3.1 Env: document `VITE_TURNSTILE_SITE_KEY`; Worker `TURNSTILE_SECRET` via secrets
- [ ] 3.2 `worker/xhs/turnstile.ts` siteverify helper; extend error code
- [ ] 3.3 `parseNote(request, env)` verify before upstream; bypass if no secret
- [ ] 3.4 Wire `env` from `worker/index.ts`
- [ ] 3.5 Frontend: Turnstile widget in `XhsDownloadTab`; pass `turnstileToken` in `xhsApi.parseXhsNote`
- [ ] 3.6 Reset widget after each parse attempt

### 4. Docs + specs
- [ ] 4.1 README: Turnstile setup + privacy/about note (privacy still bead-only wording)
- [ ] 4.2 Update `.trellis/spec/frontend/xhs-download.md` for turnstileToken + error code
- [ ] 4.3 Optional directory-structure note for `features/info`

### 5. Validate
- [ ] 5.1 `npm run build` / `npm run lint`
- [ ] 5.2 Grep Privacy page: no 小红书/xhs/xhslink/xiaohongshu
- [ ] 5.3 Manual: footer → pages → back; About shows 2 QR + email + 请作者喝一杯咖啡
- [ ] 5.4 With secret: parse without token → 中文拒绝；with token → OK  
      Without secret: parse still works (dev bypass)

## Validation commands

```bash
npm run build
npm run lint
rg -n '小红书|xhslink|xiaohongshu|/xhs' src/features/info/PrivacyPage.tsx || true
```

## Review gates

- Privacy has zero XHS product language  
- QR unlabeled  
- Only parse protected  
- Secret not in git  
- Bead path regression-free  

## Rollback

- Revert Worker turnstile + FE widget; delete info features + public/tip  

## Order

1. Assets + info pages + shell routes  
2. Turnstile worker then FE  
3. Specs/README  
4. build/lint + grep gate  
