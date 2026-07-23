# Implement plan: 拼豆图纸 AI 优化出图

## Status

**Approved** by user. Task started — implementation in progress.

## Checklist

### A. Guard / quota

- [x] Extend `effectiveUserDailyQuota` by role: user=6, vip=20, admin/super unlimited
- [x] Config keys: `image_daily_quota_user`, `image_daily_quota_vip`, `image_global_daily_cap` (migrate/seed; map from old defaults)
- [x] Preflight remaining ≥ n before edits
- [x] Deduct **k** after successful images packaged
- [x] Hide「AI 探测」except super_admin (or remove)

### B. Worker image-edit

- [x] `POST /api/ai/image-edit` multipart handler
- [x] Env: `AI_IMAGE_API_KEY`, `AI_IMAGE_BASE_URL`, model/size/template
- [x] Prompt assemble; style default chibi; max 10 chars
- [x] **Single** upstream edits call; no retry
- [x] Fetch result URLs → base64 in response
- [x] Wire `worker/index.ts`

### C. Frontend bead

- [x] AI 优化 button (pulse) on bead when image present
- [x] Panel: style, n, submit, loading, results, select, apply as source
- [x] Double-submit guard
- [x] Login gate when opening AI
- [x] Privacy blurb near AI

### D. Admin

- [x] Config fields for image quotas + global cap
- [x] Document in admin UI Chinese labels

### E. Docs / privacy

- [x] `PrivacyPage` AI upload disclosure
- [x] `docs/deploy-auth.md` or short `docs/deploy-ai-image.md` for Wisart env keys

### F. Validation

```bash
npm run lint
npm run build
# manual: skip AI local path; AI with n=2 charges 2; fail no charge; no double call
```

- [x] lint/build passed (2026-07-23 implement agent)

## Review gates

1. User approves prd + design + implement  
2. Curate implement.jsonl / check.jsonl  
3. `task.py start`  
4. trellis-implement → check → commit  

## Risks

| Risk | Mitigation |
|------|------------|
| Double-click double edits | UI disable + optional server idempotency key later |
| Large base64 response | limit n≤4; compress if needed |
| Upstream slow | Worker timeout messaging; no retry |
| Quota race | accept Phase 1; document |

## Rollback

- Disable via missing API key or `image_edit_enabled=false`
- Bead local path unaffected
