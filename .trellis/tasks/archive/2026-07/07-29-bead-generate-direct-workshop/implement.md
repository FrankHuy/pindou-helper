# 拼豆图纸生成后直接跳转工作间 — Implementation Plan

## Ordered Checklist

### 1. UI — Add "开始拼图" button to bead tab

- [ ] 1.1 在 `App.tsx` 生成成功后，显示「开始拼图」按钮（仅在有 result 时）
- [ ] 1.2 点击按钮跳转到 `/workshop`，传递当前生成参数

### 2. Work inter side — Skip Phase 1

- [ ] 2.1 新增 `loadGenerateParams()` 读取 URL 或 localStorage
- [ ] 2.2 在 `BeadWorkshopTab.tsx` Phase 1 提取色板前，自动进入 Phase 2（skip palette confirm）
- [ ] 2.3 直接调用 `recognizePattern` + `applyCorrections` 并显示最终结果

### 3. 参数传递

- [ ] 3.1 通过 URL 查询参数传递（width, palette, adjustments, mode 等）
- [ ] 3.2 工作间 `loadGenerateParams()` 解析参数

### 4. 兼容性

- [ ] 4.1 现有下载按钮保持不变
- [ ] 4.2 库存集成正常工作
- [ ] 4.3 `analyzeWorkshopImageData` 保持不变

## Risky Files

- `src/App.tsx` — 添加按钮逻辑
- `src/features/workshop/BeadWorkshopTab.tsx` — 自动 Phase 2 + 参数加载
- `src/lib/workshop/analyze.ts` — 保持 backward compat

## Review Gates

- [ ] `npm run build`
- [ ] 手动测试：生成图案 → 点击「开始拼图」 → 工作间直接显示结果
- [ ] 库存开始/结束正常工作
