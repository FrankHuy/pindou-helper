# 部署检查清单：用户体系与 AI 成本护栏（Phase 1）

面向运营/自己上线时使用。对应代码：`worker/auth/*`、`worker/guard/*`、`worker/admin/*`、`migrations/`、`wrangler.jsonc`。

---

## 0. 先读懂：邮件不是 6 位 OTP

当前实现是：

| 场景 | 用户收到什么 | 发件人是谁 |
|------|----------------|------------|
| 注册后验证邮箱 | **验证链接**（打开 `/verify?token=…`） | 见下方 **Resend `MAIL_FROM`** |
| 忘记密码 | **重置链接**（打开 `/reset?token=…`） | 同上 |

**没有**单独的「OTP 发信邮箱」配置项。  
「从哪个地址发出去」= Worker 环境变量 **`MAIL_FROM`**（须在 Resend 里验证过域名/发件地址）。  
「用哪把钥匙调 Resend」= Secret **`RESEND_API_KEY`**。

若未配置 `RESEND_API_KEY`：邮件不会真正发出，验证/重置链接会打到 **Worker 日志**（`[auth-mail:dev]`），仅适合本地调试。

生产环境不再回退到 `onboarding@resend.dev`。配置了 `RESEND_API_KEY` 但缺少 `MAIL_FROM`，或 `MAIL_FROM` 仍使用 `resend.dev` 测试域名时，Worker 会在调用 Resend 前返回明确的配置错误，避免把测试域误当成生产发件域。

---

## 1. 本项目约定（已按你的选择）

| 项 | 值 |
|----|-----|
| 超管引导邮箱 | **`Frank@Frankiehu.top`**（大小写不敏感；存库会规范化为小写） |
| 注册域名白名单 | `qq.com` / `gmail.com` / `frankiehu.top`（可在管理页由超管改） |
| 免费 AI 配额 | 默认 3 次/账号/日（UTC 日界） |
| 数据库 | Cloudflare **D1**，binding 名 **`DB`** |
| 会话 Cookie | `pd_session` |

环境变量名（与代码一致）：

```text
BOOTSTRAP_SUPERADMIN_EMAIL=Frank@Frankiehu.top
RESEND_API_KEY=re_xxxxxxxx
MAIL_FROM=拼豆助手 <noreply@pindou.de5.net>
TURNSTILE_SECRET=0x...
PASSWORD_PBKDF2_ITERATIONS=100000   # 可选
```

仓库中的实际生产发件地址为 `拼豆助手 <noreply@pindou.de5.net>`。`VITE_TURNSTILE_SITE_KEY` 继续由 Cloudflare 构建变量提供，不写入 `wrangler.jsonc`。

---

## 2. Cloudflare 资源准备

### 2.1 创建 D1 并写入 wrangler

```bash
cd /path/to/pindou-helper
npx wrangler login          # 若未登录
npx wrangler d1 create pindou-helper-db
```

命令会输出 **`database_id`（UUID）**。编辑 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "pindou-helper-db",
    "database_id": "<粘贴真实 UUID>",
    "migrations_dir": "migrations"
  }
]
```

当前仓库里的 `local-pindou-helper-db` 只是占位，**不能用于生产远程库**。

### 2.2 应用迁移

```bash
# 本地开发库
npx wrangler d1 migrations apply pindou-helper-db --local

# 生产/预发远程库
npx wrangler d1 migrations apply pindou-helper-db --remote
```

确认 `migrations/0001_auth_session.sql` 已应用（含 `users` / `sessions` / `email_tokens` / `usage_daily` / `app_config`）。

### 2.3 Workers 环境变量与 Secrets

非敏感的 Worker 运行时配置以仓库中的 `wrangler.jsonc` 为准；Cloudflare Dashboard 只保存 Secret，以及构建阶段使用的 `VITE_TURNSTILE_SITE_KEY`：

| 名称 | 类型 | 是否必填 | 说明 |
|------|------|----------|------|
| `BOOTSTRAP_SUPERADMIN_EMAIL` | `wrangler.jsonc` 明文变量 | **生产必填** | 已设为 `Frank@Frankiehu.top`。该邮箱**首次注册成功**或**完成邮箱验证**时会提升为 `super_admin`。 |
| `RESEND_API_KEY` | **Secret** | 生产必填 | [Resend](https://resend.com) API Key，`re_…`。 |
| `MAIL_FROM` | `wrangler.jsonc` 明文变量 | 生产必填 | 已设为 `拼豆助手 <noreply@pindou.de5.net>`；该域名须在 Resend 完成 DNS 验证。 |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare 构建变量 | 生产建议 | 注入前端构建，不提交到仓库。 |
| `TURNSTILE_SECRET` | **Secret** | 生产建议 | 有则注册/登录/忘记密码均校验 Turnstile；无则跳过（仅开发）。 |
| `PASSWORD_PBKDF2_ITERATIONS` | `wrangler.jsonc` 明文变量 | 可选 | 已设为 `100000`。Free 计划 CPU 紧时可暂降，**生产鉴权建议 Workers Paid**。 |
| `AI_IMAGE_BASE_URL` / `AI_IMAGE_MODEL` / `AI_IMAGE_SIZE` | `wrangler.jsonc` 明文变量 | 出图功能必填 | 已与当前 Wisart 配置统一。 |
| `AI_IMAGE_API_KEY` | **Secret** | 出图功能必填 | 只保存在 Cloudflare Runtime Secrets。 |

也可用 CLI（示例）：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put AI_IMAGE_API_KEY

# 非敏感运行时变量已由 wrangler.jsonc 管理；勿把 Secret 值写进仓库
```

`wrangler.jsonc` 的 `secrets.required` 只声明 `RESEND_API_KEY`、`TURNSTILE_SECRET`、`AI_IMAGE_API_KEY` 三个名称，不包含任何 Secret 值。当前代码未读取 `LLM_API_KEY`，所以没有把它声明为必需项。

### 2.4 绑定关系自检

部署后在 Dashboard 确认：

- [ ] D1 绑定 **`DB`** → `pindou-helper-db`
- [ ] Assets / SPA 与 `run_worker_first: ["/api/*"]` 仍生效
- [ ] Observability 日志可查看（便于看 `[auth-mail:dev]` / `[admin]`）

### 2.5 部署命令

```bash
npm run build
npm run deploy
# 等价：npm run build && wrangler deploy
```

Git 连接 Cloudflare 时：Build command `npm run build`，以仓库 `wrangler.jsonc` 为准。

---

## 3. Resend（发信）配置步骤

1. 注册 [Resend](https://resend.com)，创建 API Key → 放入 **该 Worker 生产环境** 的 Secret **`RESEND_API_KEY`**（不是 GitHub Actions、不是 Vite `VITE_*`、不是仅本地 `.env`）。
2. **Domains** 确认 `pindou.de5.net` 状态为 **Verified**，并保持 Resend 要求的 DNS 记录有效。
3. 设置 Worker **`MAIL_FROM`**，例如：
   - `拼豆助手 <noreply@pindou.de5.net>`
   - 或 `noreply@pindou.de5.net`
   - **From 的域名必须是 Resend 里已 Verified 的域名**（不能随便写未验证域）。
4. 改完 Secrets/变量后，建议 **再 Deploy 一次** Worker（部分绑定变更后更稳妥）。
5. 用真实白名单邮箱走一遍「注册 → 收验证邮件 → 点链接」。
6. 若一直收不到：
   - 看注册接口返回的 `message` / `emailSent`（新版本会写明未发出原因）。
   - Cloudflare Worker **Logs**：搜 `[auth-mail:dev]`（= 线上读不到 Key）或 `[auth-mail] resend failed`（= 调了 Resend 但被拒）。
   - Resend Dashboard → **Emails / Logs**：有没有出站记录。
   - 垃圾箱；收件邮箱是否在产品域名白名单内。

**注意：**

- 发件域（`MAIL_FROM`）与用户注册邮箱域名（白名单）是两件事：用户可用 `qq.com` / `gmail.com` 注册，信仍从你的 `pindou.de5.net` 发出。
- 超管邮箱 `Frank@Frankiehu.top` 属于白名单域 `frankiehu.top`，可直接注册。
- **本地用同一 Key 能发信，不代表线上 Worker 一定绑了这两个变量**——最常见问题是变量加在了错误的项目/环境（Preview vs Production、Pages vs Worker）。

---

## 4. 超管上线步骤（`Frank@Frankiehu.top`）

1. 生产已设置 `BOOTSTRAP_SUPERADMIN_EMAIL=Frank@Frankiehu.top`。
2. 打开站点 → **注册**，邮箱填 `Frank@Frankiehu.top`，设密码，完成 Turnstile（若已开）。
3. 查收验证邮件并打开链接（或开发环境看 Worker 日志里的 `/verify?token=…`）。
4. 登录后顶栏应出现 **「管理」**，或直接访问 `https://你的域名/admin`。
5. 在管理页确认：搜得到自己、可开关熔断、可改白名单（超管）。

若注册时未带上 bootstrap 环境变量，可在验证邮箱时补提升（代码在 verify 路径也会匹配 bootstrap 邮箱）。仍不对则用 D1 手工改角色（应急）：

```bash
npx wrangler d1 execute pindou-helper-db --remote --command \
  "UPDATE users SET role = 'super_admin' WHERE email = 'frank@frankiehu.top';"
```

---

## 5. Turnstile（与现网一致）

1. Cloudflare Dashboard → Turnstile → 站点密钥对。
2. Hostname 填生产域名。
3. 前端构建变量：`VITE_TURNSTILE_SITE_KEY`；Worker Secret：`TURNSTILE_SECRET`。
4. 浏览器应能正常加载 Turnstile，且 `/api/config` 应看到 `turnstileRequired: true`。仅使用构建变量时，`turnstileSiteKey` 可由前端构建产物提供，不要求 API 重复返回。

---

## 6. 上线验收清单（打勾）

### 基础设施

- [ ] D1 `database_id` 已替换且 **remote migrations apply** 成功  
- [ ] `BOOTSTRAP_SUPERADMIN_EMAIL=Frank@Frankiehu.top`  
- [ ] `RESEND_API_KEY` + `MAIL_FROM=拼豆助手 <noreply@pindou.de5.net>`
- [ ] Turnstile 双钥（生产）  
- [ ] `npm run deploy` 成功，HTTPS 可访问  

### 账号

- [ ] 非白名单域名注册被拒（如 `foo@outlook.com`）  
- [ ] 白名单邮箱可注册；未验证时 **AI 探测** 返回需验证类错误  
- [ ] 验证邮件可达；点链接后 `emailVerified` 为真  
- [ ] 登录 / 登出 / 忘记密码邮件与重置可用  
- [ ] 超管账号可进 `/admin`  

### 成本护栏

- [ ] 未登录 `POST /api/ai/ping` → `401 auth_required`  
- [ ] 未验证 → `403 email_unverified`  
- [ ] 验证后 ping 成功并扣次；超额 → `429 user_quota`  
- [ ] 管理页打开熔断 → `503 circuit_open`  
- [ ] AI 出图：见 `docs/deploy-ai-image.md`（`AI_IMAGE_*`、`POST /api/ai/image-edit`、按张计费）  

### 管理端

- [ ] 普通用户打开 `/admin` 被拒绝  
- [ ] 超管可搜用户、封禁、调当日额度、熔断、白名单  

### 文案

- [ ] `/privacy` 已说明：本地图纸不上传；账号/邮件/AI 登录策略（见 `PrivacyPage.tsx`）  

---

## 7. 本地开发（可选）

```bash
npm install
npx wrangler d1 migrations apply pindou-helper-db --local
npm run dev
# 或：npm run preview
```

- 可不设 `RESEND_API_KEY`：在 wrangler/dev 日志搜 `[auth-mail:dev]` 复制验证链接。  
- 可不设 Turnstile：注册/登录不校验人机。  
- 本地仍建议设 `BOOTSTRAP_SUPERADMIN_EMAIL=Frank@Frankiehu.top` 便于测管理页。

---

## 8. 费用与风险备忘

- Cloudflare **Free** 可起步，但非无限：Workers 请求/日、D1 读写/日、**KV 写极少（本方案计数走 D1，勿改回 KV 狂写）**。  
- 密码 PBKDF2 在 Free **10ms CPU** 上可能吃紧 → **生产建议 Workers Paid（约 $5/月起）**。  
- **真正要防打爆的是上游 AI API 账单**：全局日熔断 + 角色日额度（普通 6 / VIP 20 张图）+ 全站 cap；上线前在管理页确认熔断与出图配额。  
- Resend 本身按套餐计费，与 CF 分开。

---

## 9. 回滚 / 应急

- 管理页 **打开熔断** → 全站 AI 拒绝（`circuit_open`）。  
- 临时关 AI：可停用调用 `requireAiAccess` 的路由或保持熔断。  
- 封禁刷子：`/admin` 搜邮箱 → 封禁。  
- Auth 表可保留；回滚前端入口即可，不必立刻删 D1。

---

## 10. 相关文件

| 路径 | 说明 |
|------|------|
| `wrangler.jsonc` | Worker + D1 binding |
| `migrations/0001_auth_session.sql` | Schema + 默认配置种子 |
| `migrations/0002_image_edit_quota.sql` | AI 出图配额种子 |
| `docs/deploy-ai-image.md` | Wisart env + 出图验收 |
| `worker/auth/mail.ts` | Resend / dev 日志发信 |
| `worker/index.ts` | `Env` 字段说明 |
| `.trellis/tasks/07-22-user-auth-ai-cost/design.md` | 完整设计 |
| `src/features/info/PrivacyPage.tsx` | 隐私文案 |
