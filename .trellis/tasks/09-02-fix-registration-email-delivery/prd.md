# 修复注册验证邮件发送

## Goal

恢复 Cloudflare 生产环境中的注册验证邮件与密码重置邮件投递，使应用能通过
Resend 向真实用户邮箱发送邮件，并避免生产环境因静默回退到 `resend.dev`
测试发件人而再次出现 403。

## Background / Confirmed Facts

- Resend 日志返回 403：`resend.dev` 仅允许向 Resend 账户自己的邮箱发送测试邮件；
  向其他收件人发送必须先验证自有域名，并让 `from` 使用该域名。
- `worker/auth/mail.ts` 当前在 `MAIL_FROM` 缺失时回退到
  `Pindou Helper <onboarding@resend.dev>`，与本次 403 完全吻合。
- Worker 已读取运行时 `RESEND_API_KEY` 与 `MAIL_FROM`；邮件通过
  `https://api.resend.com/emails` 发送，不依赖 Vite 构建变量。
- 当前代码会将 Resend 401/403 映射为包含 API Key 与域名验证提示的失败消息，
  注册接口也会返回 `emailSent: false`，所以主要故障不是错误被吞掉。
- Resend Domains 中 `pindou.de5.net` 已处于 `Verified`，它也是当前项目的生产部署
  域名。
- `docs/deploy-auth.md` 当前示例仍使用 `noreply@frankiehu.top`，需更新为本项目
  实际已验证的发信域 `pindou.de5.net`。
- Resend 当前官方文档要求验证 SPF/DKIM；验证的根域或子域必须与 `from`
  地址域名精确匹配。
- 用户确认 Cloudflare 生产环境已存在 `AI_IMAGE_API_KEY`、`LLM_API_KEY`、
  `RESEND_API_KEY`、`TURNSTILE_SECRET` 四个加密 Secret。
- `LLM_API_KEY` 当前仓库无读取点；本任务不将其改成明文，也不把未使用的 Secret
  伪装成应用必需配置。
- 用户确认 Turnstile Site Key 已作为 Cloudflare 构建变量维护；本任务不读取或迁移
  其值，现有前端继续使用 `VITE_TURNSTILE_SITE_KEY` 构建期回退。

## Confirmed Decisions

- 生产发件身份固定为 `拼豆助手 <noreply@pindou.de5.net>`。
- 移除 `onboarding@resend.dev` 的默认发件人回退。
- 未配置 `RESEND_API_KEY` 时继续保留本地日志调试模式；一旦配置 API Key 并尝试
  真实发送，必须同时显式配置合法的 `MAIL_FROM`，否则在调用 Resend 前返回配置错误。
- 将非敏感的 `MAIL_FROM` 写入 `wrangler.jsonc` 顶层 `vars`，作为 Worker 部署配置
  的单一事实来源；`RESEND_API_KEY` 继续只保存在 Cloudflare Secret 中。
- 其余代码实际使用的非敏感生产配置也统一写入 `wrangler.jsonc`；有可靠代码默认值
  且无需运营覆盖的长提示模板继续留在代码中。
- Turnstile Site Key 按用户要求继续由 Cloudflare 构建变量管理，不在仓库中复制。

## Requirements

- R1. `worker/auth/mail.ts` 在真实 Resend 请求前校验显式 `MAIL_FROM`，缺失或使用
  `resend.dev` 时返回可操作的配置错误；无 API Key 的本地日志模式保持可用。
- R2. `wrangler.jsonc` 提供确定性的生产 `MAIL_FROM`，Cloudflare 生产 Worker 保留
  有效的 `RESEND_API_KEY` Secret；同时集中管理超管邮箱、PBKDF2 次数和 AI 图片
  上游参数等非敏感配置。
- R2a. `wrangler.jsonc` 只声明代码实际依赖的 Secret 名称，不包含 Secret 值；
  `LLM_API_KEY` 因当前未被代码读取，不加入 required-secret 声明。
- R3. 注册验证与忘记密码共用同一发件配置，修复后两条邮件路径都要验收。
- R4. 不把 API Key、真实 Secret 或其他敏感值提交到 Git。
- R5. 更新部署文档，使 Resend 域名、DNS、Cloudflare 环境变量和部署后的验证步骤
  与最终选择一致。

## Acceptance Criteria

- [x] AC1. Resend Domains 中 `pindou.de5.net` 状态为 `Verified`。
- [ ] AC2. Cloudflare 生产 Worker 同时具有有效 `RESEND_API_KEY` 和使用已验证域的
  `MAIL_FROM`，且配置在正确的 Production 环境。
- [x] AC2a. `wrangler.jsonc` 包含项目实际需要的非敏感运行配置和 required-secret
  名称，不包含任何 Secret 值或 Turnstile Site Key。
- [ ] AC3. 向非 Resend 账户邮箱注册时，Resend 不再返回 testing domain 403，
  注册响应为 `emailSent: true`，收件人可收到并打开验证链接。
- [ ] AC4. 忘记密码邮件也能送达并打开重置链接。
- [x] AC5. 缺少或误配 `MAIL_FROM` 时，Worker 返回明确配置错误，不静默依赖
  `resend.dev` 生产投递。
- [x] AC6. `npm run build` 与 `npm run lint` 通过，Secret 未进入仓库。
- [x] AC7. 部署文档包含域名精确匹配、DNS 验证、Cloudflare Production 变量和
  Resend/Worker 日志排查步骤。

## Out of Scope

- 更换 Resend 邮件服务商。
- 修改注册邮箱域名白名单、用户角色或 AI 配额。
- 引入邮件队列、营销邮件、邮件模板系统或收件功能。
