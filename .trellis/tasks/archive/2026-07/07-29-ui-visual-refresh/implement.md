# 全站 UI 视觉升级 — Implementation

## Ordered Checklist

- [x] 1. 建立 `index.css` 亮/暗语义 tokens、全局表单/焦点/动效基础和 reduced-motion。
- [x] 2. 在 `App.tsx` 实现 system/light/dark 三态主题状态、localStorage 持久化与系统主题监听。
- [x] 3. 升级品牌 topbar、主题控件、账号操作与顶部工具导航；补充轻量图形标识和移动端适配。
- [x] 4. 重构 `App.css`：生成页三栏、侧栏分组、舞台、色板、按钮和响应式全部迁移到 tokens。
- [x] 5. 升级 `workshop.css` 与必要 JSX class，统一阶段卡片、画布、颜色和库存操作。
- [x] 6. 升级 `inventory.css`，统一统计、筛选、表格、表单、状态和流水。
- [x] 7. 升级 `xhs.css`，统一输入、结果网格、lightbox 和移动端体验。
- [x] 8. 升级 `auth.css`、`admin.css`、`info.css` 与 `bead-ai.css`，完成全站覆盖。
- [x] 9. 搜索残余硬编码主题色和不一致控件；保留确属 swatch、图片遮罩或业务语义的颜色。
- [x] 10. 验证亮/暗/system 切换、刷新持久化、系统主题响应、Canvas/swatch 颜色不变。
- [x] 11. 验证桌面、中等宽度和移动端布局；检查根级横向溢出、sticky 区域与触控目标。
- [x] 12. 运行 `npm run build` 与 `npm run lint`，修复本任务引入的问题。
- [x] 13. 更新 frontend component/state/quality spec，记录主题与 design-token 约定。

## Validation

```bash
npm run build
npm run lint
```

手动验证矩阵：

- theme：system / light / dark / refresh / OS preference change；
- routes：app 四 tab、login/register/forgot/reset/verify、admin、privacy、about；
- breakpoints：宽桌面、约 900px、约 620px、窄移动端；
- states：empty/loading/error/success/disabled/focus/modal；
- invariant：Canvas、原图和 bead swatch 无主题滤镜，keep-alive tab 状态不丢失。

## Risky Files / Rollback Points

- `src/App.tsx`：只加入主题和展示层结构，不改生成/库存/认证数据流。
- `src/App.css` 与 feature CSS：分文件迁移，避免全局选择器意外覆盖 Canvas 和 swatch。
- `src/index.css`：tokens 命名稳定后再迁移各 feature，避免中途重复定义。
- 第三方 Turnstile：只调整容器背景和边界，不尝试修改 iframe 内部。
