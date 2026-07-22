# Auth session + D1

## Goal

Phase 1 identity foundation: D1 schema, email+password auth, sessions, verify/reset, Turnstile, domain allowlist, IP/fp register caps. Parent: `07-22-user-auth-ai-cost`.

## Requirements

- Follow parent `design.md` §2–3 and `implement.md` sections A–B.
- SPA auth UI under `src/features/auth/`.
- Reuse Turnstile from xhs patterns.

## Acceptance Criteria

- [x] D1 migrations + wrangler binding
- [x] register/login/logout/verify/forgot/reset/me work
- [x] Illegal email domain rejected; missing fp on register rejected
- [x] Unverified users can login but design-ready for AI lock (next child)
- [x] `npm run build` + `npm run lint` pass

## Notes

Depends on: none. Blocks: quota-guard, admin-mini.
