# 拼豆图纸生成后直接跳转工作间

## Goal

生成拼豆图纸后提供「开始拼图」按钮，一键切到工作间并直接进入最终结果，无需下载 PNG 再上传、也无需色板确认。

## Background / Confirmed Facts

- 拼豆图纸 tab 已有内存中的 `BeadPattern`（色号、格点、用量完整）。
- 工作间三阶段流程针对**外来图纸**；本工具自生成结果不需要再识别。
- bead / workshop 同在 App shell 中 keep-alive，可用 props 传递，不必 URL / localStorage。
- 库存开始/结束依赖最终 `result.colors`（`phase === 'done'`）。

## Confirmed Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | 自生成图纸 | **跳过 Phase 1 色板确认**，直接 `done` |
| 2 | 数据传递 | **App shell props 注入 `BeadPattern`**，不走下载-上传-识别 |
| 3 | 生成参数 | 图案本身已含宽高与用色；不额外传 adjustments 等 |
| 4 | 上一次制作 | **不恢复** activeSession；注入新图时清空制作会话（与新上传一致） |
| 5 | 下载 | **保留**「导出 PNG」 |
| 6 | 无源图时 | 无分界线 / 重新识别源；可提示来自生成 tab；可再上传覆盖 |

## Requirements

- R1. 生成成功（`pattern` 非空）时显示「开始拼图」按钮。
- R2. 点击后切换到「拼豆工作间」tab，并注入当前图案。
- R3. 工作间直接展示最终结果（格点 + 色号列表 + 高亮），不进入 palette / uncertain。
- R4. 库存开始/结束在 `done` 后仍可用。
- R5. 导出 PNG 行为不变。
- R6. 中文文案；色号区保留「屏幕色仅供参考」。
- R7. 用户仍可在工作间上传其他图纸走完整三阶段流程。

## Acceptance Criteria

- [ ] AC1. 有生成结果时出现「开始拼图」。
- [ ] AC2. 点击后切到工作间且无需上传即可看到图纸与用色。
- [ ] AC3. 不出现色板确认 / 不确定色阶段。
- [ ] AC4. 单色高亮与色号列表可用。
- [ ] AC5. 库存开始/结束基于注入结果的 `colors` 可用。
- [ ] AC6. 导出 PNG 仍可用。
- [ ] AC7. `npm run build` / `npm run lint` 通过。

## Out of Scope

- 通过导出 PNG 再本地识别的路径（本任务直接注入 pattern）。
- 跨刷新持久化注入结果。
- 从工作间回写生成 tab 参数。
