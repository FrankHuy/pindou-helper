# 图纸每5行辅助分隔线

## Goal

在拼豆图纸预览与导出中增加「每 5 格」辅助分隔线，方便用户数格子，覆盖**生成图纸**与**拼豆工作间**的图纸区域。

## Background

- 生成图纸（`App.tsx`）与工作间格点模式（`BeadWorkshopTab.tsx`）均经 `src/lib/pattern.ts` 的 `drawPattern` → `paintPattern` 绘制。
- 导出 PNG（`exportPattern`）同样走 `paintPattern`，且固定 `showGrid: true`。
- 当前网格为统一细线（`showGrid && cellSize >= 7`，`rgba(31,35,34,0.2)` / `lineWidth 0.5`），无「每 N 格」强调线。
- 工作间像素模式无稳定格网语义，不在本需求范围。

## Requirements

- R1. 当 `showGrid` 为真且 cellSize 达到现有网格阈值时，在**水平每 5 行**与**竖直每 5 列**的格边界上绘制辅助分隔线（十字分区）。
- R2. 生成图纸预览、工作间格点预览、导出 PNG 共用 `paintPattern`，行为一致、无绘制分叉。
- R3. 辅助线样式：同色系更深 + 略粗（相对普通网格 `0.5px / 0.2 alpha`，目标约 `1px`、更高不透明度），可与普通网格区分，且不严重遮挡色号。
- R4. 辅助线跟随 `showGrid`：关闭「网格」时普通网格与辅助线均不绘制；导出仍强制 `showGrid: true`。
- R5. 间隔固定为 5；不做 UI 配置项、不做独立「仅辅助线」开关。
- R6. 不破坏现有高亮/变暗（`highlightCode` / `HIGHLIGHT_DIM_ALPHA`）；辅助线在填色与 dim 之后、色号文字之前或之后绘制时，须保证网格结构仍清晰、文字仍可读。
- R7. 工作间像素模式不绘制本辅助线。

## Acceptance Criteria

- [x] AC1. 生成图纸预览在「网格」开启时，水平每隔 5 行、竖直每隔 5 列可见明显强于普通网格的辅助线。
- [x] AC2. 工作间「格点识别」图纸预览同样显示该辅助线。
- [x] AC3. 导出 PNG 含相同辅助线规则。
- [x] AC4. 普通网格与辅助线可区分；小 cellSize 时不崩、不糊成一片。
- [x] AC5. 高亮单色时辅助线仍可见，dim 逻辑正常。
- [x] AC6. 生成图纸关闭「网格」后，普通网格与 5 格辅助线均消失。

## Out of Scope

- 可配置间隔或独立辅助线开关。
- 行号/列号刻度数字。
- 图例布局与识别算法改动。
- 工作间像素模式辅助线。

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | 方向 | 每 5 行横线 + 每 5 列竖线 |
| D2 | 与网格开关 | 跟随 `showGrid`；关则两者都不画 |
| D3 | 样式 | 更深 + 略粗（同色系，非主题色） |
| D4 | 实现落点 | 优先改 `paintPattern` 一处，预览与导出自然一致 |

## Technical Notes

- 主改文件：`src/lib/pattern.ts`（`paintPattern` 网格段）。
- 调用方（`App.tsx` / `BeadWorkshopTab.tsx` / `exportPattern`）原则上无需改 API；若需可选开关再扩展 `DrawOptions`（本任务不要求）。
- 辅助线绘制位置：在普通 `strokeRect` 网格之后叠加全长横/竖线，避免与 per-cell 描边重复变脏。
- 线位置：`row % 5 === 0` / `col % 5 === 0` 的格边界（含 outer 0 边界与 pattern 内每 5 格边界）；外框是否加粗可与内部分界一致处理。

## Notes

- 轻量任务：PRD-only，无需单独 `design.md` / `implement.md`。
