# 拼豆图纸 AI 优化出图

## Goal

在「拼豆图纸」中增加**可选** AI 优化：默认仍用原图本地生成；用户主动点「AI 优化」后，将图交由 Worker 代理调用外部 edits API，得到 1–4 张候选图，选定一张后再走现有抠图 / 像素化 / 导出。额度按**成功输出张数**计，并与角色、全站上限、管理配置打通。

## Background

- 本地主路径：`File → createPattern → 预览/导出`（不上传）。
- 已有账号、验证邮箱、D1、`requireAiAccess`、usage_daily、`/admin`。
- 上游：`POST {base}/v1/images/edits`（multipart image + prompt + model/size/n）；示例 base `https://wisart.kuaileshifu.com`。
- 历史 **`POST /api/ai/ping`**：仅本地护栏桩，**不调用生图 API**；顶栏「AI 探测」易误解，本任务默认对普通用户隐藏。

## Confirmed Decisions

| 主题 | 决策 |
|------|------|
| 默认路径 | **跳过 AI**；AI 为可选按钮（可适度闪动） |
| 流程 | A → 一次 edits → A1…An → 用户选一张 → 现有 bead 流程 |
| 画风 | 默认 `chibi`；可自填；**最多 10 字符**；无多预设列表 |
| Prompt | `{style}画风, 纯白/绿底. pixel art style, 16-bit, retro game aesthetic, sharp focus, high contrast, clean lines, detailedpixel art, masterpiece, best quality` |
| model/size | 用户不可见；默认 `gpt-image-2` / `1024x1024`；env 可改 |
| 结果 | Worker **同源**拉取/交付；禁止前端直链依赖 |
| 成本 | **每用户提交只调 1 次 edits**；禁止自动重试生图 |
| 扣费 | 按成功交付的**张数 k**；失败 k=0 不扣 |
| 个人日额度 | user **6**、vip **20**、admin/super **个人不限** |
| 全站 | 日上限 + 熔断；管理可配 |
| 密钥 | 仅 Worker 运行时 |

## Requirements

### R1 UX

1. 有原图时显示「AI 优化」（闪动可关 `prefers-reduced-motion`）。
2. 面板：画风、张数 1–4、剩余额度、提交；防连点。
3. 候选图网格 → 选用 → 替换为后续生成源图。
4. 未登录引导登录；跳过永不强制登录。
5. 明示：使用 AI 将上传图片至服务器并转发第三方。

### R2 Worker

1. `POST /api/ai/image-edit`；Key 不下发。
2. 单次 edits；结果 url 由 Worker 拉取后 base64（或等价同源）返回。
3. 校验 style≤10、n∈[1,4]、图片类型/大小。

### R3 配额

1. 张数计量；角色默认与 override；全站 cap。
2. 管理端可配 user/vip/global 等。
3. 与 ping 脱钩展示；出图为产品计费入口。

### R4 约束

- 跳过 AI：图片不上传。
- 兼容 wrangler SPA + D1。

## Acceptance Criteria

- [x] 默认可本地生成；可选 AI → 选图 → 图纸流程一致。
- [x] 一次提交一次 edits；无自动重试生图。
- [x] 扣费按成功张数；普通 6/VIP 20/管理个人不限；全站上限。
- [x] Key 仅服务端；Privacy 有 AI 上传说明。
- [x] `design.md` / `implement.md` / jsonl 已评审通过；`task.py start` 已执行。
- [x] lint/build 通过（实现后）。

## Out of Scope

- 工作间/XHS AI；VIP 支付；mask；模型训练。

## Open Questions

（产品决策已收敛；实现默认见 design）

- 全站默认日 cap 数值：design 暂用 500，上线前可调。
- 结果拉取失败是否对单张重试 HTTP GET（**不是** edits）：允许最多 1 次 GET 重试。

## Notes

- Task dir: `.trellis/tasks/07-23-bead-ai-image-edit`
- 详设：`design.md`；执行：`implement.md`
