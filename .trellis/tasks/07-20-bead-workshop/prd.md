# 拼豆工作间：图纸上传与色号高亮

## Goal

新增独立 Tab **「拼豆工作间」**：用户上传一张**已有拼豆图纸图**（上格点图案 + 下用色图例），本地识别用色并生成可点色号按钮；点击后图纸中对应豆子高亮，便于按色分批拼豆。

与 **「拼豆图纸」**（照片 → 生成）互补：工作间**消费**已导出图纸，不负责从照片量化生成。

## Background / Confirmed decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Tab 名 | 拼豆工作间 |
| 2 | 输入范围 | **B**：本工具导出 PNG + 同类「上图下图例」第三方图；非手机拍实体板 |
| 3 | 上下分割 | 自动估计 + **用户可拖分隔线** 后重识别 |
| 4 | 色号身份 | **D 混合无 OCR**：图例色块 → MARD 最近色 → 按钮；图案映射到用色集合 |
| 5 | 空格 | **A**：浅底 / 远离用色集合 → 无豆；不进按钮 |
| 6 | 高亮 | **A**：焦点不透明 + 其它 dim（对齐现有 `HIGHLIGHT_DIM_ALPHA`）；再点取消；MVP **单色** |
| 7 | 几何 | **C**：格点重建优先 → 失败 **像素色掩膜** 回退 |
| 8 | 格点成功预览 | **A**：重建格点画布（类 `drawPattern`）；回退时原图 + 像素掩膜；UI 提示当前模式 |
| 9 | 隐私 | 全浏览器本地 Canvas；不上传图纸 |
| 10 | 依赖 | 无 OCR、无新运行时依赖（与 quality 规范一致） |

### Codebase anchors

- Tabs：`AppTab = 'bead' | 'xhs'`（`src/App.tsx`）；bead 区 `is-hidden` 保状态；已有 `/privacy` `/about` shell  
- 高亮/绘制：`drawPattern` + `highlightCode`（`src/lib/pattern.ts`）  
- 导出版式：`exportPattern` = pattern + gap +「用色统计」legend  
- 色卡：`src/lib/palettes/` MARD；`colorDistance` / `closestColor` 现为 pattern 内私有  

## Requirements

### Must

- R1. 顶层 Tab **拼豆工作间**，与「拼豆图纸 / 小红书下图」可切换；切换不丢其它 Tab 状态（与现 bead 保活策略一致）  
- R2. 本地上传 png/jpg/webp 图纸图  
- R3. 自动估计图案/图例分界；**可拖分隔线**；松手或确认后重新识别  
- R4. 图例色块 → MARD 色号按钮（swatch + code）；**无 OCR**；展示 **「屏幕色仅供参考」**  
- R5. 空格规则 A：浅底/远离用色集合不进列表、不高亮为目标  
- R6. 几何 C + 预览 A：格点成功 → 重建画布 + 可选每色计数；失败 → 像素掩膜仍可按色 dim 高亮；模式文案可见  
- R7. 点击色号 dim 高亮；再点取消  
- R8. 全本地；中文错误（识别失败、无数色等）+ 可调分隔重试  
- R9. `npm run build` / `npm run lint` 通过；bead 生成与 XHS 无回归  

### Should

- R10. 移动端色号按钮可滚动/换行；图纸区可缩放（至少 CSS/控件 zoom）  
- R11. 本工具 `exportPattern` 样例默认走格点路径成功率高  

### Out of scope

- 照片→生成（已有 Tab）  
- 实体板拍照 / 透视矫正  
- 图例 OCR、服务端识别、批量/云同步、改色回写导出  
- 多色同时高亮  

## Acceptance Criteria

- [ ] AC1. 存在 Tab「拼豆工作间」，可上传「上图下图例」图片  
- [ ] AC2. 自动或手调分隔后出现色号按钮；来自色卡匹配；空/白底不进列表  
- [ ] AC3. 点色号 → 对应区域 dim 高亮；再点取消  
- [ ] AC4. 拖动分隔线可触发/允许重新识别  
- [ ] AC5. 本工具导出图可走格点重建预览；格点失败时像素模式仍可高亮  
- [ ] AC6. UI 标明「格点识别」或「像素模式」；有「屏幕色仅供参考」  
- [ ] AC7. build + lint 通过；无新增 OCR/CV 运行时依赖；图纸不上传服务器  

## Technical notes (non-design detail)

- 建议模块：`src/features/workshop/`（UI）+ `src/lib/workshop/` 或 `src/lib/pattern-import.ts`（纯算法，无 React）  
- 可复用 `BeadPattern` / `drawPattern` 于格点成功路径；需导出或抽取 `closestColor` 色距逻辑避免复制分叉  
- 不新增路由 path（Tab 内视图即可）；info shell 保持不变  

## Open questions

- （无阻塞产品项；实现阈值与格点检测细节见 `design.md`）  
