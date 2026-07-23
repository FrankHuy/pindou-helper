# Design: 拼豆图纸 AI 优化出图

## 1. Scope / Trigger

- **In**: Bead tab optional AI pre-step; Worker proxy to Wisart-compatible `POST /v1/images/edits`; per-image daily quotas by role; admin config; single upstream call per user submit.
- **Out**: Workshop/XHS AI; VIP payment; mask; auto-retry of edits.

## 2. Architecture

```
Bead UI (App.tsx)
  ├─ default: local file → createPattern (unchanged)
  └─ optional: AI 优化 panel
        → POST /api/ai/image-edit (multipart, credentials)
        → show candidates (同源 data/blob URLs)
        → user picks one → replace source File/Image → existing pipeline

Worker
  POST /api/ai/image-edit
    requireAiAccess (extended for image units + role limits)
    validate style (≤10), n (1–4), image type/size
    assemble prompt from template + style
    **one** fetch to {AI_IMAGE_BASE_URL}/v1/images/edits
    for each result url: Worker fetch image bytes (not a second edits)
    deduct usage by successful image count k
    return { images: [{ id, mime, base64 }] }  // or short-lived ids

  POST /api/ai/ping  — keep for ops; hide from normal UI (see §8)
```

### Boundaries

| Module | Owns | Must not |
|--------|------|----------|
| `worker/ai/imageEdit.ts` | upstream edits + result fetch | retry edits |
| `worker/guard/*` | auth + quota preflight + deduct by units | store API key in logs |
| `src` bead AI panel | UX, flash button, pick candidate | hold Bearer key |
| Admin | config keys for quotas | call Wisart |

## 3. API contracts

### `POST /api/ai/image-edit`

- **Auth**: session cookie; same gates as AI (login, not banned, email verified, circuit, quotas).
- **Body**: `multipart/form-data`
  - `image`: file (required; jpg/jpeg/png/webp/gif; max size e.g. 8MB design default)
  - `style`: string optional; trim; empty → `chibi`; max **10** chars
  - `n`: string/number 1–4 (default 1)
- **Server adds**: `model`, `size`, `prompt`, `response_format` optional (prefer url then worker fetch; if upstream supports b64 use it to skip re-fetch when possible — still **one** edits call).

**Success 200**:

```json
{
  "ok": true,
  "charged": 2,
  "remaining": { "user": 4, "userLimit": 6, "global": 100, "globalLimit": 500 },
  "images": [
    { "index": 1, "mime": "image/png", "base64": "..." }
  ]
}
```

**Errors** (existing + new):

| Condition | HTTP | error |
|-----------|------|--------|
| No session | 401 | `auth_required` |
| Unverified | 403 | `email_unverified` |
| Banned | 403 | `banned` |
| Circuit | 503 | `circuit_open` |
| User/global/associate over | 429 | `user_quota` / `global_quota` / `associate_quota` |
| Bad image / style / n | 400 | `invalid_request` |
| Upstream fail / empty data | 502 | `upstream_failed` |
| Partial: edits OK but zero images fetchable | 502 | `result_fetch_failed` (charged=0) |

### Prompt assembly

```
DEFAULT_TEMPLATE =
"{style}画风, 纯白/绿底. pixel art style, 16-bit, retro game aesthetic, sharp focus, high contrast, clean lines, detailedpixel art, masterpiece, best quality"

prompt = template.replaceAll("{style}", style || "chibi")
```

Env `AI_IMAGE_PROMPT_TEMPLATE` overrides template if non-empty and contains `{style}`.

### Env (Worker runtime)

| Name | Required | Default |
|------|----------|---------|
| `AI_IMAGE_API_KEY` | yes for feature | — |
| `AI_IMAGE_BASE_URL` | yes | e.g. `https://wisart.kuaileshifu.com` |
| `AI_IMAGE_MODEL` | no | `gpt-image-2` |
| `AI_IMAGE_SIZE` | no | `1024x1024` |
| `AI_IMAGE_PROMPT_TEMPLATE` | no | code default |

## 4. Quota model (images)

### Units

- **Billable unit** = one successfully delivered candidate image to the client response (decoded base64 after edits result).
- Preflight: require `remaining >= n` for user (if limited) and global before calling upstream (reserve check; no pre-deduct row required if we only deduct after success — **race accepted Phase 1** or use conditional increment).
- On success with `k` images: `incrementUsage` by **k** for `user`, `global`, and optionally `ip`/`fp` associate (same k or 1 request — **use k** for consistency with cost).
- On total failure: **charge 0**.
- **Never** auto-retry edits. Result URL fetch may retry **fetch only** (not edits) at most once per URL if desired; prefer fail that slot and keep others.

### Role limits

| Role | Personal daily images |
|------|------------------------|
| `user` | `image_daily_quota_user` default **6** |
| `vip` | `image_daily_quota_vip` default **20** |
| `admin` / `super_admin` | **unlimited** personal (`null` / -1) |
| override | `users.daily_quota_override` if set (images/day) |

Global: `image_global_daily_cap` (default e.g. 500 or reuse/rename `global_daily_cap` with migration note).

### Relation to `/api/ai/ping`

- Ping is a **local stub** from auth Phase 1; does **not** call Wisart.
- Image edit uses **image-oriented** config keys and billing.
- Prefer **separate** usage subject or scale: simplest path — reuse `usage_daily` subject `user`/`global` but change defaults to 6/20 and document that ping also increments same counters if left enabled → **hide ping UI** for non-super to avoid confusion; optional: ping deducts 0 or uses subject `ping`.

**Decision**: Hide「AI 探测」for roles other than `super_admin`. Image edit is the product path. Config defaults updated to user=6, vip=20; effective quota function reads role.

## 5. Frontend UX

1. After user has a source image on bead tab: show **AI 优化** button (subtle pulse/flash CSS once or gentle loop, `prefers-reduced-motion` respected).
2. Default path unchanged (no AI).
3. Open panel: style input (placeholder chibi, maxLength 10), n select 1–4, quota remaining hint from `/api/me`, submit.
4. Loading: disable double-submit (important: one in-flight request).
5. Results grid: radio/click select; **使用此图** → set as new source blob/file, close panel, keep rest of controls.
6. Errors: Chinese; no automatic second request.

## 6. Admin

Extend mini admin config (super or admin as per matrix):

- Edit `image_daily_quota_user`, `image_daily_quota_vip`, `image_global_daily_cap`, circuit (existing).
- Existing per-user override continues to mean images/day for edit.

## 7. Privacy

- Skip AI: no upload.
- Use AI: copy near button — 图片将上传至服务器并转发至第三方图像服务。
- Update `PrivacyPage` in implement checklist.

## 8. Cost / reliability principles

1. **One edits call per user click.**
2. No client retry loop; no server retry of edits on 5xx (return error).
3. Result image HTTP fetch is not “edits”; may fail independently; charge only images included in JSON response.
4. Cap concurrent per user optional later.

## 9. Rollout

- Feature flag config `image_edit_enabled` default true when API key present.
- Without `AI_IMAGE_API_KEY`: endpoint 503 `not_configured`; UI disable with message.

## 10. Wrong vs correct

```ts
// Wrong — retry edits on display failure
await edits(); await edits();

// Correct — single edits, then fetch URLs
const r = await editsOnce();
const images = await mapFetchResults(r.data); // no second edits
charge(images.length);
```
