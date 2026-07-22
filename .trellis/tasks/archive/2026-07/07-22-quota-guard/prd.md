# AI quota guards

## Goal

Usage counters + `requireAiAccess` + stub `POST /api/ai/ping`. Parent design §4.

## Requirements

- Depends on **auth-session** (session + users).
- Daily user/ip/fp/global limits; circuit breaker; deduct after success.

## Acceptance Criteria

- [x] Unauthenticated / unverified / banned / over quota / circuit return stable error codes
- [x] Successful ping increments counters
- [x] `GET /api/me` includes quota snapshot

## Notes

Blocks: admin-mini usage views.
