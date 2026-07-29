# 拼豆图纸生成后直接跳转工作间 — Design

## Scope

添加「一键开始拼图」按钮到拼豆图纸生成 tab。
点击后直接跳转到拼豆工作间，并自动填充当前生成图案（无需下载再上传）。

## Architecture

### 新增交互逻辑

- 生成成功后，在 `App.tsx` 的 bead tab 中显示「开始拼图」按钮（仅在有 result 时）
- 点击按钮：跳转到 `/workshop`，并通过 URL 参数或 localStorage 传递当前生成参数
- 工作间 `BeadWorkshopTab.tsx` 读取 URL 参数或 localStorage 中的 `generateParams`，调用 `analyzeWorkshopImageData` 直接进入 Phase 2（无需 Phase 1）

### 工作间端

- 新增 `loadGenerateParams()` 读取 URL / localStorage
- 在 Phase 1 提取色板前，自动进入 Phase 2（skip palette confirm）
- 直接调用 `recognizePattern` + `applyCorrections`（空分配）并显示最终结果
- 保留所有现有功能（高亮、缩放、重新识别、库存）

### 兼容性

- 现有下载按钮保持不变，用户仍可手动下载 PNG
- 现有 `analyzeWorkshopImageData` API 保持不变，直接调用即可
- 库存集成仅在最终 `result` 可用时出现

## Trade-offs

| Choice | Pros | Cons |
|--------|------|------|
| 直接进入 Phase 2 | 无需用户确认色板，生成后一键拼图 | 用户无法修改色板（若有误识别，可手动删除再重新生成） |
| 通过 URL 传递参数 | 简单，无需额外状态管理 | URL 长度限制（若超过可改用 localStorage） |
| 自动 Phase 2 skip | 减少一步，符合用户「直接开始拼图」需求 | 需确保生成结果符合工作间识别逻辑 |

## Rollback

1. 删除「开始拼图」按钮
2. 保留下载按钮
3. 工作间端恢复 Phase 1 确认色板流程
