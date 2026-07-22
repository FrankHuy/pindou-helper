# Implement plan: 用户体系与 AI 成本治理

## Status

**Phase 1 implementation complete** (2026-07-22).
Children archived: `auth-session`, `quota-guard`, `admin-mini`.
Phase 2 (VIP/pay) and Phase 3 (full admin) remain future work — parent may archive as Phase-1-done or stay open for next wave.

## Scope for first implementation wave (Phase 1)

Parent task may stay planning-orchestrator; prefer **child tasks** when starting work:

| Child (suggested) | Deliverable | Depends on |
|-------------------|-------------|------------|
| `auth-session` | D1 schema, register/login/verify/reset/session, Turnstile, allowlist, IP/fp register caps | — |
| `quota-guard` | usage_daily, requireAiAccess, stub `/api/ai/ping`, associate+global limits | auth-session |
| `admin-mini` | `/api/admin/*` + SPA `/admin` | auth-session, quota-guard |

If implementing as one wave without children, follow the same order.

## Checklist

### A. Infrastructure

- [x] Add D1 database binding to `wrangler.jsonc`
- [x] Create SQL migrations: users, sessions, email_tokens, usage_daily, app_config
- [x] Seed default app_config (allowlist, quotas, caps)
- [x] Env secrets: Turnstile (existing), mail API key, `BOOTSTRAP_SUPERADMIN_EMAIL`
- [x] Document Free vs Paid CPU risk for PBKDF2

### B. Auth backend

- [x] Password hash helpers (PBKDF2-SHA-256)
- [x] `POST /api/auth/register` (Turnstile, allowlist, caps, verify email)
- [x] `POST /api/auth/login` / `POST /api/auth/logout`
- [x] `POST /api/auth/verify` / resend verify
- [x] `POST /api/auth/forgot` / `POST /api/auth/reset`
- [x] `GET /api/me` (user + quota snapshot)
- [x] Session cookie middleware
- [x] Register/login rate limits + fp requirement on register

### C. Cost guard

- [x] `usage_daily` increment helpers (UTC day)
- [x] `requireAiAccess` middleware pipeline (design §4)
- [x] `POST /api/ai/ping` stub for end-to-end guard test
- [x] Global circuit flag read (write via admin-mini next)
- [x] Response error codes stable for UI

### D. Admin mini

- [x] Admin authz helper
- [x] Users search / ban / unban / quota override
- [x] Usage summary + circuit endpoints
- [x] Allowlist + role change (super only)
- [x] SPA `/admin` minimal UI
- [x] SPA auth pages (register/login/reset/verify UX)

### E. Frontend integration

- [x] Auth feature module under `src/features/auth/`
- [x] Admin under `src/features/admin/`
- [x] Wire session into app shell (show user, quota)
- [x] Reuse Turnstile patterns from `src/features/xhs/`

### F. Validation

```bash
npm run lint   # app/worker clean (ignore .pi warnings)
npm run build  # pass
# wrangler d1 migrations apply pindou-helper-db --local
# manual: register blocked domain; verify gate; quota 429; admin ban
npm run preview   # if applicable
```

- [x] lint + build green after all three children
- [ ] Operator: create real D1 `database_id`, apply migrations, set secrets (Turnstile, Resend, BOOTSTRAP_SUPERADMIN_EMAIL=Frank@Frankiehu.top) — full checklist: `docs/deploy-auth.md`
- [x] Privacy copy updated for account/email/AI; deploy checklist written

## Review gates

1. User approves `prd.md` + `design.md` + this file  
2. `implement.jsonl` / `check.jsonl` curated  
3. `task.py start` (or start first child)  
4. After code: `trellis-check` before claiming done  

## Rollback points

- Before enabling public AI: guards must be live  
- Config `circuit_open=true` emergency stop  
- Drop AI routes without removing auth tables  

## Out of this wave

- Real model provider integration  
- Payment / VIP purchase  
- Third-party full admin  
- xhs login wall  

## Risks

| Risk | Mitigation |
|------|------------|
| Free 10ms CPU vs PBKDF2 | Tune iters; recommend Workers Paid for prod auth |
| KV write limits | Do not use KV for counters |
| FP spoofing | Soft signal only; global circuit hard cap |
| Mail deliverability | Use reputable provider; clear UX if delayed |
| Admin route exposure | Server role checks; no client-only gate |
