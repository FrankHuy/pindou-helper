# Admin mini UI

## Goal

Same-origin mini admin API + SPA `/admin` per parent design §5 and role matrix.

## Requirements

- Depends on **auth-session** and **quota-guard**.
- Admin/super_admin only; super-only allowlist + role change.

## Acceptance Criteria

- [x] Search/ban/quota/circuit work for admin
- [x] Allowlist + role for super_admin only
- [x] Non-admin cannot call APIs (403)

## Notes

Not a full third-party admin (Phase 3).
