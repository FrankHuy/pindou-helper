# 修复注册验证邮件发送 — Design

## Scope

修复 Cloudflare Worker 通过 Resend 发送注册验证与密码重置邮件时的 testing-domain
403，并让后续 Git/Wrangler 部署不会因遗漏 `MAIL_FROM` 再次回退到
`onboarding@resend.dev`。

涉及边界：

- `worker/auth/mail.ts`：邮件运行时配置验证与 Resend 请求。
- `wrangler.jsonc`：非敏感生产发件地址的部署事实来源。
- `docs/deploy-auth.md`：Resend、Cloudflare 与上线验收说明。

不修改注册业务、邮箱白名单、D1、邮件模板和 Resend API Key。

## Configuration Contract

| Name | Storage | Planned value / source |
|---|---|---|
| `RESEND_API_KEY` | Cloudflare Secret | Existing; value never committed |
| `TURNSTILE_SECRET` | Cloudflare Secret | Existing; value never committed |
| `AI_IMAGE_API_KEY` | Cloudflare Secret | Existing; value never committed |
| `MAIL_FROM` | `wrangler.jsonc.vars` | `拼豆助手 <noreply@pindou.de5.net>` |
| `BOOTSTRAP_SUPERADMIN_EMAIL` | `wrangler.jsonc.vars` | Existing project decision: `Frank@Frankiehu.top` |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare build variable | Existing; preserved outside repo per user decision |
| `PASSWORD_PBKDF2_ITERATIONS` | `wrangler.jsonc.vars` | `100000` |
| `AI_IMAGE_BASE_URL` | `wrangler.jsonc.vars` | `https://wisart.kuaileshifu.com` |
| `AI_IMAGE_MODEL` | `wrangler.jsonc.vars` | `gpt-image-2` |
| `AI_IMAGE_SIZE` | `wrangler.jsonc.vars` | `1024x1024` |

`AI_IMAGE_PROMPT_TEMPLATE` stays on its tested code default. `LLM_API_KEY` is already stored as a
Secret but currently has no reader in this repository, so it is neither exposed nor declared as
required by this task.

- `pindou.de5.net` 已在 Resend Domains 中处于 `Verified`。
- `MAIL_FROM` 是公开发件身份，写入 `wrangler.jsonc.vars`。
- `RESEND_API_KEY` 是敏感凭据，只存在于实际生产 Worker 的 Secret 中。
- `from` 的域必须与 Resend 已验证域精确匹配。
- `wrangler.jsonc.secrets.required` declares `RESEND_API_KEY`, `TURNSTILE_SECRET`, and
  `AI_IMAGE_API_KEY` by name only so Wrangler can detect missing runtime bindings without storing
  their values.

## Mail State Flow

```text
sendAuthEmail(env, message)
  ├─ RESEND_API_KEY missing
  │    → local/dev console mode; log action link; report not delivered
  ├─ API key present + MAIL_FROM missing
  │    → config failure before fetch; actionable Chinese error
  ├─ API key present + MAIL_FROM uses resend.dev
  │    → config failure before fetch; tell operator to use verified domain
  └─ API key + verified MAIL_FROM present
       → POST https://api.resend.com/emails
            ├─ 2xx → delivered request accepted (`mode: resend`)
            └─ non-2xx/network → existing safe error handling
```

The failure result gains `mode: 'config'` so logs and callers can distinguish local console
fallback, local configuration failure, and an actual Resend rejection. Existing public API
continues to expose `mailMode` as a string and remains backward compatible.

## Error Contract

| Condition | Fetch Resend? | Result |
|---|---:|---|
| Missing API key | No | `ok: false`, `mode: console`, existing local-debug message |
| Missing `MAIL_FROM` | No | `ok: false`, `mode: config`, explicit Cloudflare/Wrangler configuration message |
| Explicit `@resend.dev` sender | No | `ok: false`, `mode: config`, require verified-domain sender |
| Resend 401/403 | Yes | Existing authentication/domain verification message |
| Resend 422 | Yes | Existing sender/recipient format message |
| Resend 2xx | Yes | `ok: true`, `mode: resend`, optional message id |

No error or public response may expose the API key. The configured `from` may remain in Worker
operator logs because it is a public mail identity, but public API diagnostic fields stay limited
to booleans.

## Validation Strategy

- Bundle/import the pure mail module in a temporary Node harness and mock `fetch`:
  - missing API key does not call fetch;
  - API key + missing sender does not call fetch and returns `mode: config`;
  - API key + `resend.dev` sender does not call fetch and returns `mode: config`;
  - valid `pindou.de5.net` sender calls fetch with the exact `from` value.
- Run `npm run build` and `npm run lint`.
- Inspect Git diff to confirm no Secret was added.
- Validate Wrangler configuration contains no Turnstile key value and the existing frontend
  build-time `VITE_TURNSTILE_SITE_KEY` fallback code remains unchanged; `/api/config` must still never expose
  `TURNSTILE_SECRET`.
- After deployment, register a non-owner test mailbox and request a password reset; verify both
  messages in Resend logs and the recipient inbox.

## Rollout / Rollback

Rollout occurs through the normal Git/Wrangler deployment. Before live verification, confirm the
production Worker still has the three declared required Secrets. `wrangler.jsonc.vars` supplies
the agreed non-sensitive runtime bindings; Cloudflare continues to supply
`VITE_TURNSTILE_SITE_KEY` as a build variable.

Rollback can revert the code/config commit, but restoring the `resend.dev` fallback would restore
the original failure mode and is not recommended. Operational rollback should instead disable
registration temporarily or correct the verified sender configuration.
