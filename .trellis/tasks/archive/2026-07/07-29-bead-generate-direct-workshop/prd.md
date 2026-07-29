# 拼豆图纸生成后直接跳转工作间

## Goal

生成（或编辑）拼豆图纸后，提供「一键开始拼图」按钮，直接跳转到拼豆工作间并自动填充图案。

## Background

- 当前流程：生成 → 下载 PNG → 工作间上传 → 识别 → 确认色板 → 拼图。
- 用户希望生成后立即进入工作间，无需下载再上传。
- 已有 `BeadWorkshopTab` 支持直接通过 `analyzeWorkshopImageData` 加载结果。

## Confirmed Decisions

| # | Decision | 说明 |
|---|----------|------|
| 1 | 默认自己识别的图纸 | **不需要进入 Phase 1 确认色板**，直接进入 Phase 2 识别阶段并显示最终结果 |
| 2 | 保留生成参数 | 跳转时把当前生成参数（width、palette、adjustments、mode、bgRemoveEnabled 等）通过 URL 或 localStorage 传递给工作间 |
| 3 | 不需要继续上一次 | 无需恢复 activeSession，跳转后直接从新结果开始 |
| 4 | 直接进入 Phase 2 | 工作间自动调用 `analyzeWorkshopImageData`（或 staged API）并显示最终结果，无需用户确认色板 |

## Requirements

- 生成成功后，在拼豆图纸 tab 显示「开始拼图」按钮
- 点击按钮：跳转到 /workshop 页面，自动填充图案
- 工作间自动使用当前生成结果（无需上传）
- 保留高亮、缩放、分界线、重新识别功能
- 所有 UI 文案中文，保留「屏幕色仅供参考」

## Acceptance Criteria

- [ ] 生成成功后出现「开始拼图」按钮
- [ ] 点击按钮直接跳转工作间并自动识别
- [ ] 工作间直接显示最终结果，无需 Phase 1 确认色板
- [ ] 库存开始/结束正常工作
- [ ] 现有拼豆图纸 / 小红书 / 登录功能无回归

## Out of Scope

- 自动识别后进入 Phase 1（需要用户确认色板）
- 保留下载按钮（用户仍可手动下载）
