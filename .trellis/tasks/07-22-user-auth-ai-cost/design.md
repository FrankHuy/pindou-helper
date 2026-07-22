# Design: 用户体系与 AI 成本治理（Phase 1 为主）

## 1. Architecture

```
SPA (React)
  ├─ auth UI: register / login / verify notice / reset password
  ├─ account: quota remaining (from /api/me)
  ├─ admin mini: /admin (role gate)
  └─ future AI feature → POST /api/ai/* only

Worker (existing worker/index.ts router)
  ├─ /api/config          (extend: feature flags if needed)
  ├─ /api/auth/*          register, login, logout, verify, reset
  ├─ /api/me              session profile + quota snapshot
  ├─ /api/admin/*         search, ban, quota adjust, circuit, allowlist
  ├─ /api/ai/*            guard middleware then provider (stub OK)
  └─ /api/xhs/*           unchanged (no login required)

D1
  ├─ users, sessions, email_tokens
  ├─ usage_daily (user / ip / fingerprint / global)
  └─ app_config (allowlist, limits, circuit flag)

Email provider (Resend etc.)
Turnstile (existing)
```

### Boundaries

| Module | Owns | Must not |
|--------|------|----------|
| `worker/auth/*` | credentials, sessions, verify/reset | AI provider calls |
| `worker/guard/*` | quota, associate limits, circuit | password logic |
| `worker/admin/*` | admin APIs + authz | public register role escalation |
| `src/features/auth/*` | auth screens | embed secrets |
| `src/features/admin/*` | mini admin UI | call AI as admin bypass |

## 2. Data model (D1)

### users

| column | type | notes |
|--------|------|-------|
| id | text PK | ulid/uuid |
| email | text unique | normalized lower |
| email_domain | text | for allowlist analytics |
| password_hash | text | PBKDF2 params embedded or side columns |
| password_salt | text | |
| password_iters | integer | |
| email_verified_at | integer null | unix ms |
| role | text | `user` \| `vip` \| `admin` \| `super_admin` |
| plan | text | `free` \| `vip` … reserve |
| banned_at | integer null | |
| ban_reason | text null | |
| daily_quota_override | integer null | admin per-user cap |
| created_at / updated_at | integer | |

### sessions

| column | notes |
|--------|------|
| id | public session id (random) |
| user_id | fk |
| token_hash | sha-256 of secret cookie value |
| expires_at | |
| created_ip / created_fp_hash | optional audit |
| revoked_at | null = active |

### email_tokens

- purpose: `verify` | `reset`
- token_hash, user_id, expires_at, consumed_at

### usage_daily

| key dimensions | notes |
|----------------|------|
| day (YYYY-MM-DD UTC) | |
| subject_type | `user` \| `ip` \| `fp` \| `global` |
| subject_key | user id / ip / fp hash / `global` |
| count | integer |
| unique (day, subject_type, subject_key) | |

### app_config

- key/value JSON or typed rows: `email_domain_allowlist`, `default_daily_quota`, `ip_fp_daily_cap`, `global_daily_cap`, `circuit_open`, `register_ip_daily_cap`, `register_fp_daily_cap`, …

## 3. Auth flows

### Register

1. Client: email, password, Turnstile token, fingerprint id.
2. Server: verify Turnstile → allowlist domain (exact domain match, case-insensitive; no free subdomain pass) → password policy → IP/fp register caps → create user `role=user` → send verify email → optional session (logged in but AI locked until verify).
3. Bootstrap: if email matches `BOOTSTRAP_SUPERADMIN_EMAIL`, set `super_admin`.

### Login

1. Turnstile + email/password → constant-time compare path → issue session cookie.
2. Rate limit by IP and by email on failures.
3. Banned users: reject.

### Verify / Reset

- One-time tokens in email links (`/api/auth/verify?token=` or SPA route that posts token).
- Reset consumes token and sets new password; revoke other sessions.

### Session cookie

- Name e.g. `pd_session`
- Value: opaque secret; D1 stores hash only
- Flags: `HttpOnly; Secure; SameSite=Lax; Path=/`
- Admin mutating requests: require same-origin + header check (`Origin`/`Referer`) or CSRF double-submit if cookie session

### Password hashing

- **PBKDF2-SHA-256** via `crypto.subtle` (Workers-supported).
- Random 16+ byte salt; iterations configurable (start e.g. 100k on Paid; if Free 10ms CPU binds, lower with documented risk or require Paid for auth Worker).
- **Risk**: Free plan 10ms CPU may be insufficient for strong KDF — treat **Workers Paid** as recommended for production auth.

## 4. AI cost guard pipeline

Order for every `/api/ai/*` (and shared helper `requireAiAccess`):

1. Session present → else 401 `auth_required`
2. User not banned → else 403 `banned`
3. `email_verified_at` set → else 403 `email_unverified`
4. Global circuit closed and `global` daily count < cap → else 503 `circuit_open` / 429 `global_quota`
5. User daily count < effective quota (`override` ?? role/plan default ?? 3) → else 429 `user_quota`
6. IP and fp daily counts < associate caps → else 429 `associate_quota`
7. Execute provider (Phase 1 may stub)
8. On **billable success**: increment user + ip + fp + global (same UTC day) in one batch/transaction when possible
9. Return remaining quota in response headers or body

### Defaults (config)

| key | default |
|-----|---------|
| user daily | 3 |
| ip/fp associate daily | 10 |
| global daily | config required before enable AI (e.g. 500) |
| register per IP / day | e.g. 3 |
| register per fp / day | e.g. 2 |

### Deduct policy

- **Default**: increment only after upstream success (no charge on 4xx validation).
- If provider may charge on timeout: document and prefer pre-reserve row + confirm (Phase 1.1).

## 5. Admin mini API

All require session role ∈ {admin, super_admin}.

| endpoint | admin | super |
|----------|:-----:|:-----:|
| GET /api/admin/users?q= | ✓ | ✓ |
| POST /api/admin/users/:id/ban | ✓ (not super targets) | ✓ |
| POST /api/admin/users/:id/unban | ✓ | ✓ |
| POST /api/admin/users/:id/quota | ✓ | ✓ |
| GET /api/admin/usage/summary | ✓ | ✓ |
| GET/POST /api/admin/circuit | ✓ | ✓ |
| GET/PUT /api/admin/allowlist | | ✓ |
| POST /api/admin/users/:id/role | | ✓ |

UI: SPA route `/admin`, hide link unless role allows; still enforce on API.

## 6. Fingerprint

- Client generates stable-ish visitor id (canvas/webgl/lightweight hash or `FingerprintJS` open source if license OK).
- Send header `X-Client-Fp` on register and AI calls.
- Server stores **SHA-256** only; treat as soft signal.
- Missing fp: apply stricter IP-only caps or reject register (prefer **require fp on register**).

## 7. Compatibility

- Existing xhs routes unchanged; no auth.
- Local bead tools remain client-side.
- `Env` gains: `DB` (D1), mail secrets, `BOOTSTRAP_SUPERADMIN_EMAIL`, session signing not required if opaque random tokens.
- Migrations via wrangler D1 migrations folder.

## 8. Observability

- Structured logs: auth_fail, register_reject (reason), quota_hit, circuit_open, admin_action.
- Optional: daily counts readable in admin summary (from `usage_daily`).

## 9. Security checklist

- No password in logs; no token plaintext in DB.
- Timing-safe password compare.
- Turnstile on register/login/forgot.
- Admin role checks server-side only.
- Rate limits on auth endpoints.
- CORS: same-origin SPA; credentials include.

## 10. Rollout / rollback

- Feature flag `AUTH_ENABLED` / `AI_GUARDS_ENABLED` in config.
- Rollback: disable AI routes; auth tables can remain.
- Bootstrap superadmin env must be set before production open register.

## 11. Phase 2/3 hooks

- `role=vip` / `plan` already on user; quota table by plan in config JSON.
- Phase 3: Refine/React-Admin against `/api/admin/*`; keep authz identical.

## 12. Third-party decision (Auth/Admin)

| Layer | Decision | Reason |
|-------|----------|--------|
| Auth | **Self-build on Workers+D1** | Custom allowlist, fp, quota in one pipeline; CF Free-friendly without second vendor lock-in |
| Admin Phase 1 | **Custom mini page** | Small surface; full admin overkill |
| Admin Phase 3 | **Evaluate Refine/React-Admin** | Only if mini page ops cost too high |
