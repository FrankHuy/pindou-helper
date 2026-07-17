# Implementation Plan

## Execution Checklist

### 0. 分支准备
- [ ] 0.1 从 main 创建并切换到 `feature/palette-quality-controls`
- [ ] 0.2 确认工作区干净或仅有无关 untracked（`.pi` / `.trellis` / `AGENTS.md` / `requirements` 可保留 untracked，不混入本功能提交）

### 1. 色卡数据与解析 (R1)
- [ ] 1.1 创建 `src/lib/palettes/types.ts`：`BeadColor` / `PaletteRange` / `MerchantPackSize` / `PaletteSelection` / `ResolvedPalette`
- [ ] 1.2 从 `requirements/mard-color-chart.json` 生成 `src/lib/palettes/mard-colors.ts`（291 色 + STANDARD/EXTENDED/ALL_SERIES）
- [ ] 1.3 从 `requirements/mard-merchant-packs.json` 生成 `src/lib/palettes/mard-packs.ts`（11 套装 codes）
- [ ] 1.4 实现 `src/lib/palettes/resolve.ts`：`resolvePalette(selection)`（套装覆盖 range → 系列筛选 → 禁用）
- [ ] 1.5 创建 `src/lib/palettes/index.ts` 统一导出
- [ ] 1.6 改 `src/lib/palette.ts` 为 re-export 壳（`BeadColor` + `MARD_PALETTE` = 完整 291 色）；删除旧 33 色硬编码
- [ ] 1.7 改 `src/lib/pattern.ts`：`createPattern(file, PatternOptions)`；保留直接匹配路径

### 2. 最大颜色数控制 (R2)
- [ ] 2.1 在 `pattern.ts` 实现 median-cut（输入像素 RGB 数组 + maxColors → 每像素代表色索引）
- [ ] 2.2 `maxColors > 0 && maxColors < palette.length` 时：quantize → closestColor(palette)；否则直接匹配
- [ ] 2.3 空 palette 时抛出明确错误

### 3. 图片基础调整 (R3)
- [ ] 3.1 在 `pattern.ts` 实现 `applyAdjustments`（亮度 → 对比度 → 饱和度）
- [ ] 3.2 `createPattern` 在匹配前应用 adjustments
- [ ] 3.3 创建 `src/lib/presets.ts`：`NEUTRAL_PRESET` + `IMAGE_PRESETS`（照片/头像/卡通/Logo）

### 4. App.tsx UI 整合
- [ ] 4.1 state：`paletteSel`（range/merchantPack/seriesFilter）/ `disabledColors` / `maxColors` / `adjustments`
- [ ] 4.2 `useMemo` 调用 `resolvePalette` 得到 `resolved`
- [ ] 4.3 `generate` + `scheduleGenerate`（300ms 防抖，ref 读最新参数）
- [ ] 4.4 控制区：颜色数量分段（8/16/24/32/48/不限）
- [ ] 4.5 控制区：亮度/对比度/饱和度滑块 + 预设按钮组（原图/照片/头像/卡通/Logo）
- [ ] 4.6 色卡面板：范围三按钮 + 商家套装选择 + 系列筛选 + 禁用切换
- [ ] 4.7 色卡面板：`生效 N / 范围 M` + 「屏幕色仅供参考」
- [ ] 4.8 `colorUsage` 基于 resolved.colors + pattern.counts

### 5. App.css
- [ ] 5.1 色卡禁用态样式
- [ ] 5.2 范围/套装/预设按钮组样式
- [ ] 5.3 滑块分组（复用 `.control-group`）
- [ ] 5.4 系列筛选 chips 样式

### 6. 验证
- [ ] 6.1 `npm run build` 通过
- [ ] 6.2 `npm run lint` 通过
- [ ] 6.3 切换 full/standard/extended：色数分别为 291/221/70（禁用前）
- [ ] 6.4 选商家套装 96：生效色 = 96 个 code
- [ ] 6.5 系列筛选仅 A：仅 A 系列出现在生效集
- [ ] 6.6 禁用某色后该色不出现在图纸 counts
- [ ] 6.7 maxColors=16 时图纸使用色数 ≤ 16
- [ ] 6.8 亮度/对比度/饱和度与预设可工作
- [ ] 6.9 PNG 导出仍可用

### 7. 合并
- [ ] 7.1 在 feature 分支提交功能改动
- [ ] 7.2 checkout main，merge `feature/palette-quality-controls`
- [ ] 7.3 main 上 `npm run build` 通过

## Data generation helper (optional one-shot)

```bash
# 可用 python 一次性生成 mard-colors.ts / mard-packs.ts，不作为运行时依赖
python3 - <<'PY'
# 读取 requirements/*.json 写出 src/lib/palettes/mard-*.ts
PY
```

## Validation Commands

```bash
npm run build
npm run lint
npm run dev
```

## Review Gates

- 步骤 1 完成：`resolvePalette` 对 full/standard/extended/pack 的色数与源 JSON 一致
- 步骤 2–3 完成：`createPattern` 编译通过，无旧签名调用残留
- 步骤 4 完成：UI 四层选择 + 调参可交互
- 步骤 6 全部通过后才合并

## Rollback Points

- 数据文件生成错误 → 对照 JSON 重新生成，不手改 291 行
- UI 整合失败 → 先保证 lib 层可独立 build，再修 App.tsx
- 合并冲突 → 在 feature 上 rebase/merge main 后再合入

## Notes for implementer

- 旧 33 色 **不要** 保留为 basic 规格。
- 商家套装必须按 code 列表，禁止 `colors.slice(0, N)`。
- `name` 字段 = `code`。
- 默认：range=`standard`，merchantPack=`null`，maxColors=不限，adjustments=原图。
