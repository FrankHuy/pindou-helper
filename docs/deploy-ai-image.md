# AI 出图（拼豆图纸 · AI 优化）部署说明

可选功能：用户在拼豆图纸主动点「AI 优化」后，Worker 代理调用 Wisart 兼容的 `POST /v1/images/edits`，同源返回候选图 base64。默认本地生成路径不上传图片。

## 1. 环境变量（Worker 运行时）

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `AI_IMAGE_API_KEY` | 是（启用功能） | — | 上游 Bearer；**仅** Worker secret，勿写进 `VITE_*` |
| `AI_IMAGE_BASE_URL` | 建议 | `https://wisart.kuaileshifu.com` | 无尾斜杠；实际请求 `{base}/v1/images/edits` |
| `AI_IMAGE_MODEL` | 否 | `gpt-image-2` | 用户不可见 |
| `AI_IMAGE_SIZE` | 否 | `1024x1024` | 用户不可见 |
| `AI_IMAGE_PROMPT_TEMPLATE` | 否 | 代码内默认（含 `{style}`） | 须包含 `{style}` 才会覆盖 |

示例（生产）：

```bash
npx wrangler secret put AI_IMAGE_API_KEY
# 可选 vars 可写在 Dashboard / wrangler 非密钥配置
# AI_IMAGE_BASE_URL=https://wisart.kuaileshifu.com
```

未配置 `AI_IMAGE_API_KEY` 时：`POST /api/ai/image-edit` → `503 not_configured`。

## 2. D1 迁移

```bash
npx wrangler d1 migrations apply pindou-helper-db --remote
# 本地：
npx wrangler d1 migrations apply pindou-helper-db --local
```

`0002_image_edit_quota.sql` 种子：

- `image_daily_quota_user` = 6  
- `image_daily_quota_vip` = 20  
- `image_global_daily_cap` = 500  
- `image_edit_enabled` = true  

角色：`admin` / `super_admin` 个人日额度不限；用户表 `daily_quota_override` 仍覆盖个人上限。

## 3. API

- `POST /api/ai/image-edit` multipart：`image` + 可选 `style`（≤10）+ `n`（1–4）  
- 会话 Cookie + 邮箱已验证 + 熔断/配额预检（`remaining ≥ n`）  
- **每次用户提交只调 1 次**上游 edits；结果 URL 由 Worker GET（可重试 1 次 GET）  
- 成功按返回张数 `k` 扣费；全失败不扣  

`POST /api/ai/ping` 仍为护栏桩，**不**调生图；UI 仅 `super_admin` 显示「AI 探测」。

管理：`GET/POST /api/admin/config/image-quota` 调整 user/vip/global 与开关。

## 4. 验收手测

1. 未点 AI：本地上传 → 生成图纸，无上传。  
2. 未登录点 AI → 引导登录。  
3. 已登录 `n=2` 成功 → 扣 2；失败 → 不扣。  
4. 连点提交 → 仅一次 in-flight（按钮禁用）。  
5. `/privacy` 含 AI 上传说明。  

## 5. 相关文件

| 路径 | 说明 |
|------|------|
| `worker/ai/imageEdit.ts` | 上游 edits + 结果拉取 |
| `worker/guard/requireAiAccess.ts` | 角色额度 + units 预检 |
| `src/features/bead/*` | 拼豆图纸 AI 面板 |
| `migrations/0002_image_edit_quota.sql` | 配额配置种子 |
