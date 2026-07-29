# 全站 UI 视觉升级 — Design

## Design Direction

采用“温润创作工坊”：

- 亮色：暖米白画布、纸白表面、森林绿主操作、陶土橙有限强调。
- 暗色：深橄榄灰画布、暖黑表面、柔和薄荷绿主操作、低饱和陶土橙强调。
- 中等品牌感：精修现有四色拼豆标记，使用克制的点阵纹理；不加入吉祥物或大面积插画。
- 舒适但紧凑：品牌和内容容器适度留白，高密度工作区、色板和表格保持效率。
- 轻微功能性动效：约 150–200ms，仅用于 hover、press、tab、card 和状态反馈；支持 reduced motion。

## Architecture

### 1. Semantic design tokens

在 `src/index.css` 建立全局 token，覆盖：

- color：canvas / surface / elevated / text / muted / border / brand / accent / success / warning / danger；
- shape：小、中、大圆角与 pill；
- elevation：低、中、高层级阴影；
- spacing / motion / focus ring；
- 原生表单基础样式与选择文本、scrollbar、focus-visible。

`html[data-theme='light|dark']` 表示手动或解析后的实际主题；业务 CSS 只引用语义 token，不直接依赖主题判断。色板 swatch、图片和 Canvas 不使用滤镜。

### 2. Theme controller

在 App shell 增加：

```ts
type ThemePreference = 'system' | 'light' | 'dark'
```

- localStorage key：`pindou-theme`；
- 默认 `system`；
- `matchMedia('(prefers-color-scheme: dark)')` 解析实际主题；
- system 模式监听系统变化；
- 将实际主题写入 `document.documentElement.dataset.theme` 和 `color-scheme`；
- 顶部提供紧凑三态切换，带可读 label/title/aria。

不引入全局状态库或新依赖。

### 3. Shell and navigation

- 保留顶部品牌栏 + 顶部工具切换栏，避免挤压三栏 Canvas 工作区。
- 顶部品牌栏强化 logo、标题、当前工具副标题、主题与账号操作。
- 四个 tab 使用轻量图形标识与更明确 active 状态；移动端保持四项可用，必要时缩短副视觉而不隐藏文字。
- 页脚与信息页共用 tokens。

### 4. Common visual primitives

通过 class 约定和通用选择器统一既有元素，不引入组件库：

- primary / secondary / ghost / danger buttons；
- inputs / selects / textareas / range / checkbox；
- chips / segmented controls / badges；
- cards / panels / section headings；
- empty / loading / error / success / warning；
- sticky toolbar / modal / table / pagination。

只在需要语义层级或图形标识时小幅调整 JSX；避免为了样式大规模重构业务组件。

### 5. Surface-specific layout

- **拼豆图纸**：左参数 / 中画布 / 右色板三栏保留；侧栏改为紧凑卡片分组，舞台强化创作画布感，主要操作层级明确。
- **拼豆工作间**：上传、阶段、色板、库存状态统一为工作流卡片；主画布与工具栏延续生成页语言。
- **库存**：统计卡片、表格、筛选和流水统一 tokens；表格继续在自身容器滚动。
- **小红书**：输入卡片、结果网格、lightbox 与状态反馈统一；保留移动优先。
- **认证 / 管理 / 信息页**：采用同一品牌头部、surface、form、table 和状态体系。

## Responsive Strategy

- `> 1100px`：完整三栏工作区。
- 中等宽度：收窄侧栏并允许色板下移，保持 Canvas 主区优先。
- 移动端：画布优先，其后参数与色板；顶部导航紧凑；触控目标不小于约 40px。
- 仅表格、色板或 Canvas 内部允许受控横向滚动，页面根节点不得产生意外横向溢出。

## Accessibility

- 全局 `:focus-visible` ring；
- hover 不是唯一状态表达；
- disabled 与文本对比度在两套主题可辨识；
- icon-only 操作提供 aria-label/title；
- `prefers-reduced-motion: reduce` 关闭非必要 transition/animation；
- 主题控件对辅助技术暴露当前偏好。

## Compatibility and Risk

- 不改变业务 state、API、Canvas 算法、对象 URL、keep-alive 和认证逻辑。
- 最大风险是旧 CSS 中硬编码颜色遗漏、深色下第三方 Turnstile/图片区域对比度、移动端高密度布局回归。
- 采用 tokens → shell → 各 feature 的顺序迁移，每完成一层进行搜索和响应式审查。

## Rollback

- Theme controller 与主题 UI 可独立移除。
- CSS token 改造与 JSX class 调整按提交 diff 回滚，不涉及数据迁移。
- localStorage 中遗留的 `pindou-theme` 在无控制器时无副作用。
