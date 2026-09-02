# 修复注册验证邮件发送 — Implementation Plan

## Ordered Checklist

### 1. Harden mail configuration

- [x] 1.1 Remove `DEFAULT_FROM` / implicit `onboarding@resend.dev` fallback from
  `worker/auth/mail.ts`.
- [x] 1.2 Extend failed mail mode with `config`.
- [x] 1.3 When API key is present but `MAIL_FROM` is missing, fail before `fetch` with an
  actionable Chinese configuration error.
- [x] 1.4 When an explicitly configured sender uses `resend.dev`, fail before `fetch` with an
  actionable verified-domain error.
- [x] 1.5 Preserve missing-API-key console mode and safe public diagnostic booleans.

### 2. Make deployment configuration deterministic

- [x] 2.1 Add top-level `wrangler.jsonc.vars.MAIL_FROM` with
  `拼豆助手 <noreply@pindou.de5.net>`.
- [x] 2.2 Add the confirmed non-sensitive runtime variables:
  `BOOTSTRAP_SUPERADMIN_EMAIL`, `PASSWORD_PBKDF2_ITERATIONS`, `AI_IMAGE_BASE_URL`,
  `AI_IMAGE_MODEL`, and `AI_IMAGE_SIZE`.
- [x] 2.3 Declare `RESEND_API_KEY`, `TURNSTILE_SECRET`, and `AI_IMAGE_API_KEY` under
  `secrets.required` by name only.
- [x] 2.4 Do not add `LLM_API_KEY` as a required binding while it has no code reader, and do not
  add any Secret value to tracked configuration.
- [x] 2.5 Preserve the existing Cloudflare build-time `VITE_TURNSTILE_SITE_KEY`; do not copy its
  value into the repository.

### 3. Synchronize operator documentation

- [x] 3.1 Replace obsolete `frankiehu.top` sender examples with the verified
  `pindou.de5.net` sender where they describe this deployment.
- [x] 3.2 Remove documentation of the implicit Resend test-domain fallback.
- [x] 3.3 Document configuration failure behavior, exact-domain matching, Wrangler as source of
  truth, and production Secret verification.
- [x] 3.4 Update the registration/reset live acceptance checklist.

### 4. Validation

- [x] 4.1 Temporary mocked-fetch harness covers console, missing sender, `resend.dev`, and valid
  verified sender paths.
- [x] 4.2 `npm run build`.
- [x] 4.3 `npm run lint`.
- [x] 4.4 `git diff --check` and Secret scan.
- [x] 4.5 Validate Wrangler configuration and `/api/config` public-field behavior.
- [ ] 4.6 After deploy, confirm registration verification and password-reset delivery to a
  non-owner test mailbox; verify links open successfully.

## Risky Files / Rollback Points

- `worker/auth/mail.ts`: shared by registration verification, resend-verification, and password
  reset. A failure here affects all transactional auth mail.
- `wrangler.jsonc`: deployment source of truth; malformed JSONC or incorrect `vars` can block or
  misconfigure deployment.
- `docs/deploy-auth.md`: must match the actual production sender and Cloudflare configuration.

Rollback: revert the task commit, then redeploy. Do not delete or rotate `RESEND_API_KEY` unless
there is independent evidence of credential compromise.
