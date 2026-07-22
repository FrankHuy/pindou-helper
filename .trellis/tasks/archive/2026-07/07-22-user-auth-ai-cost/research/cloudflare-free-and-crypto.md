# Research: Cloudflare Free limits & password hashing on Workers

Date: 2026-07-22  
Sources: Cloudflare Docs (`workers/platform/pricing`, `workers/platform/limits`, `d1/platform/pricing`, `kv/platform/pricing`, `workers/runtime-apis/web-crypto`)

## Free plan (order of magnitude)

| Product | Free inclusion | Overflow behavior |
|---------|----------------|-------------------|
| Workers requests | 100,000 / day | Error 1027 when exceeded |
| Workers CPU / request | 10 ms | Hard limit on Free |
| D1 rows read | 5,000,000 / day | Queries fail when exceeded |
| D1 rows written | 100,000 / day | Queries fail when exceeded |
| D1 storage | 5 GB total | Need cleanup / paid |
| KV reads | 100,000 / day | Ops fail when exceeded |
| KV writes | **1,000 / day** | Ops fail when exceeded |
| Workers Paid | ~$5 / mo base | Much higher inclusions |

Implications for this task:

1. **Authoritative counters (quota, register rate, global trip) → D1**, not KV writes.
2. KV only for optional short-lived cache if read-heavy and write-rare.
3. Free **10 ms CPU** is tight for heavy password KDFs; design must budget hashing cost.
4. Upstream **AI API cost** remains the financial risk to circuit-break; CF is usually cheaper at early scale.

## Web Crypto on Workers

- Full SubtleCrypto surface with algorithm matrix; **PBKDF2** and **HMAC** and **AES-GCM** are supported.
- No native bcrypt/argon2 in Web Crypto; those need WASM/JS and more CPU.
- Recommendation: **PBKDF2-SHA-256** with per-user random salt, iteration count tuned for Paid CPU budget; document minimum iterations and revisit if on Free only.
- Session tokens: random 256-bit, store **hash** server-side in D1; cookie `HttpOnly; Secure; SameSite=Lax` (or Strict for admin).

## Turnstile

- Already used for `POST /api/xhs/parse`.
- Site key via `/api/config`; secret via `TURNSTILE_SECRET`.
- Reuse same pattern for register/login (and optionally forgot-password request).

## Email

- Not provided by Workers Free as a first-class mailer.
- Use external provider (Resend / Mailchannels / etc.) with API key in secrets.
- Templates: verify email, reset password.

## Admin UI third parties (Phase 3 only)

| Option | Fit with Workers+D1 | Notes |
|--------|---------------------|-------|
| Refine + custom data provider | Good | Needs REST we already own |
| React-Admin | Good | Same |
| AdminJS | Weaker on pure CF | Often Node-centric |
| Supabase/Appwrite studio | Poor fit if Auth is self-hosted on D1 | Dual systems |
| Keep custom mini admin | Best Phase 1 | Already chosen |

Phase 1 conclusion: **no third-party admin**; Phase 3 re-evaluate Refine/React-Admin against `/api/admin/*`.
