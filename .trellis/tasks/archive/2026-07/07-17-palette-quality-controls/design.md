# Technical Design

## Overview

三个功能模块在 `src/lib/` 内部独立改造，在 `src/App.tsx` 内通过参数面板 + 色卡面板串联。

色卡数据源：

- `requirements/mard-color-chart.json` → 291 色完整色号
- `requirements/mard-merchant-packs.json` → 11 个商家套装 code 列表
- `requirements/mard-color-layers.md` → 分层逻辑参考

旧 `src/lib/palette.ts` 中 33 色自编 MVP 数据与真实 MARD 编号冲突，**整体弃用**，不再作为 basic 规格保留。

## Module 1: 色卡数据结构重构 (R1)

### 目标目录

```
src/lib/palettes/
  types.ts              — 类型定义
  mard-colors.ts        — 291 色完整数据（从 mard-color-chart.json 转换）
  mard-packs.ts         — 商家套装 code 列表（从 mard-merchant-packs.json 转换）
  resolve.ts            — 根据选择条件算出生效色集
  index.ts              — 对外导出
```

`palette.ts` 改为 re-export 壳，避免破坏现有 import 路径。

### types.ts

```ts
export type BeadColor = {
  brand: string                 // 'MARD'
  series: string                // 'A' | 'B' | ... | 'ZG'
  code: string
  name: string                  // 暂用 code 占位
  hex: string
  rgb: [number, number, number]
}

/** 色号范围（与源页面三档对齐） */
export type PaletteRange = 'full' | 'standard' | 'extended'

/** 商家套装尺寸；null = 未启用套装 */
export type MerchantPackSize =
  | 24 | 48 | 72 | 96 | 120 | 144 | 168 | 192 | 216 | 221 | 264
  | null

export type PaletteSelection = {
  brand: string                 // 默认 'MARD'
  range: PaletteRange           // 默认 'standard'
  merchantPack: MerchantPackSize // 默认 null
  seriesFilter: string[] | null  // null = 全选；否则仅保留这些系列
  disabled: Set<string>          // 用户禁用的 code
}

export type ResolvedPalette = {
  colors: BeadColor[]           // 最终生效色
  totalInScope: number          // 当前范围/套装未禁用前的色数
  label: string                 // 如 "标准系列 221" / "商家套装 96"
}
```

向后兼容：`BeadColor` 保留 `code / name / hex / rgb`，pattern.ts 无需改字段访问。

### mard-colors.ts

- 从 `mard-color-chart.json` 的 `colors` 数组手工/脚本转换成 TS 常量 `MARD_COLORS: BeadColor[]`。
- 每个色加 `brand: 'MARD'`。
- 导出辅助常量：
  - `STANDARD_SERIES = ['A','B','C','D','E','F','G','H','M']`
  - `EXTENDED_SERIES = ['P','Q','R','T','Y','ZG']`
  - `ALL_SERIES = [...STANDARD_SERIES, ...EXTENDED_SERIES]`

### mard-packs.ts

```ts
export const MARD_PACK_SIZES = [24, 48, 72, 96, 120, 144, 168, 192, 216, 221, 264] as const
export const MARD_PACKS: Record<string, string[]> = {
  '24': ['A4', 'A6', ...],
  // ...
}
```

codes 直接来自 `mard-merchant-packs.json` 的 `packs[size].codes`。

### resolve.ts — 生效色集算法

```
function resolvePalette(selection: PaletteSelection): ResolvedPalette:
  1. 若 merchantPack != null:
       base = MARD_COLORS.filter(c => MARD_PACKS[pack].includes(c.code))
       label = `商家套装 ${pack}`
  2. 否则按 range:
       full     → 全部 291
       standard → series ∈ STANDARD_SERIES
       extended → series ∈ EXTENDED_SERIES
  3. 若 seriesFilter != null:
       base = base.filter(c => seriesFilter.includes(c.series))
  4. totalInScope = base.length
  5. colors = base.filter(c => !disabled.has(c.code))
  6. return { colors, totalInScope, label }
```

约束：

- 商家套装启用时 **覆盖** range（套装已定义具体子集）。
- 系列筛选与 range/套装 **正交**。
- 禁用色在最后一层剔除。
- 空色集时 `createPattern` 应返回明确错误（"请至少启用一种颜色"），UI 侧禁用全部时阻止生成。

### index.ts

```ts
export type { BeadColor, PaletteRange, PaletteSelection, ResolvedPalette, MerchantPackSize }
export { MARD_COLORS, STANDARD_SERIES, EXTENDED_SERIES, ALL_SERIES } from './mard-colors'
export { MARD_PACKS, MARD_PACK_SIZES } from './mard-packs'
export { resolvePalette } from './resolve'
```

### palette.ts re-export 壳

```ts
export type { BeadColor } from './palettes/types'
export { MARD_COLORS as MARD_PALETTE } from './palettes/mard-colors'
```

`MARD_PALETTE` 名字保留，指向完整 291 色，避免旧引用挂掉；App.tsx 实际走 `resolvePalette`。

### UI 色卡选择器

控制区或色卡面板顶部：

1. **范围**：完整(291) / 标准(221) / 扩展(70) 三个分段按钮；默认标准。
2. **商家套装**：下拉或分段，含「不使用套装」+ 11 个尺寸；选中后覆盖 range 显示态（range 按钮可 dim 或显示为参考）。
3. **系列筛选**：多选 chips（当前范围内出现的系列）；默认全选。
4. **色号列表**：当前生效色；点击切换禁用态（视觉：opacity 降低 + 删除线）。
5. 顶部文案：`生效 N / 范围 M` + 「屏幕色仅供参考」。

## Module 2: 最大颜色数控制 (R2)

### 算法：Median-Cut Quantization

1. 收集调整后的所有像素 RGB。
2. 反复二分：取最长通道范围的簇，按该通道中位数切开，直到簇数 = maxColors（或簇无法再分）。
3. 每簇取平均 RGB → 代表色。
4. 每个像素映射到最近代表色（欧氏距离）。
5. 每个代表色再 `closestColor` 到生效色卡 → 得到最终 BeadColor。
6. 像素写回对应 BeadColor。

最终图纸使用色数 ≤ maxColors，且全部来自色卡。

### 短路条件

- `maxColors` 为 0 / undefined → 不限，直接每像素匹配色卡。
- `maxColors >= palette.length` → 跳过 quantize，直接匹配（避免无意义开销）。

### pattern.ts 签名

```ts
export type ImageAdjustments = {
  brightness: number   // -100 ~ +100
  contrast: number
  saturation: number
}

export type PatternOptions = {
  targetWidth: number
  palette: BeadColor[]
  maxColors?: number              // 0 / undefined = 不限
  adjustments?: ImageAdjustments
}

export async function createPattern(
  file: File,
  options: PatternOptions,
): Promise<BeadPattern>
```

内部流程：

```
ImageBitmap → Canvas → getImageData
  → applyAdjustments
  → if maxColors > 0 && maxColors < palette.length:
       medianCut → 代表色 → closestColor(palette)
    else:
       每像素 closestColor(palette)
  → cells + counts
```

median-cut 与 applyAdjustments 作为 `pattern.ts` 内部函数，不导出（除非后续单测需要）。

## Module 3: 图片基础调整 (R3)

### applyAdjustments

对 `Uint8ClampedArray` 就地修改：

- **亮度**：`channel += brightness * 2.55`，clamp 0–255
- **对比度**：`factor = (259 * (c + 255)) / (255 * (259 - c))`，`v = factor * (v - 128) + 128`
- **饱和度**：`gray = 0.299r + 0.587g + 0.114b`，`v = gray + (v - gray) * (1 + s/100)`

顺序：亮度 → 对比度 → 饱和度（与常见图像编辑器一致）。

### 预设（src/lib/presets.ts）

```ts
export const NEUTRAL_PRESET = { id: 'neutral', name: '原图', brightness: 0, contrast: 0, saturation: 0 }

export const IMAGE_PRESETS = {
  photo:   { id: 'photo',   name: '照片', brightness: 0,  contrast: 10, saturation: 10 },
  avatar:  { id: 'avatar',  name: '头像', brightness: 10, contrast: 15, saturation: 20 },
  cartoon: { id: 'cartoon', name: '卡通', brightness: 5,  contrast: 25, saturation: 30 },
  logo:    { id: 'logo',    name: 'Logo', brightness: 0,  contrast: 40, saturation: 0 },
} as const
```

UI：选择预设 → 写三个滑块；手动拖滑块 → 若值不再匹配任何预设则取消高亮。

## App.tsx 改造

### 新增 State

```ts
const [paletteSel, setPaletteSel] = useState<Omit<PaletteSelection, 'disabled'>>({
  brand: 'MARD',
  range: 'standard',
  merchantPack: null,
  seriesFilter: null,
})
const [disabledColors, setDisabledColors] = useState<Set<string>>(new Set())
const [maxColors, setMaxColors] = useState(0) // 0 = 不限
const [adjustments, setAdjustments] = useState(NEUTRAL_PRESET)
```

`resolved = useMemo(() => resolvePalette({ ...paletteSel, disabled: disabledColors }), [...])`

### 防抖重新生成

所有调参源收敛到 `scheduleGenerate`（300ms debounce），`generate` 通过 ref 读最新 `file / targetWidth / resolved.colors / maxColors / adjustments`，避免闭包过期与竞态。

生成期间若再次触发，只保留最后一次结果（可用 generation token / abort 标志）。

### 色卡面板

- 标题：`resolved.label` + `生效 {resolved.colors.length} / {resolved.totalInScope}`
- 副标题：「屏幕色仅供参考」
- 列表：当前范围内全部色（含禁用态），用量来自 `pattern.counts`；禁用色 count 显示为 0 或隐藏用量。
- 用量排序：按 count 降序；未使用色可折叠到底部或仅在「显示全部色号」时展示。

最小实现：列表展示 **当前范围全部色号**（可滚动），禁用态可见；用量 > 0 的排前面。

## Branch Strategy

```
main ← feature/palette-quality-controls
```

单功能分支；完成后 merge 回 main。

## Compatibility

| 项 | 策略 |
|----|------|
| 旧 33 色 MVP | 弃用，不 re-export 旧数据 |
| `BeadColor` 字段 | 保留 code/name/hex/rgb，新增 brand/series |
| `createPattern` 签名 | 破坏性改为 `PatternOptions`（调用点仅 App.tsx） |
| PNG 导出 | 不变 |
| PWA | 不变 |

## Libraries

无新依赖。median-cut、adjustments 纯 TS。

## Data conversion note

291 色 + 套装列表体积不大（约几十 KB），直接内嵌 TS 常量即可，不需要运行时 fetch JSON。可用一次性 node/python 脚本从 requirements/*.json 生成 `mard-colors.ts` / `mard-packs.ts`，脚本不必提交（或放 `scripts/` 可选）。

## Risks

1. **色号无中文名**：UI 只显示 code，用户可能不习惯；已标注 out of scope。
2. **HEX 近似值**：必须在 UI 声明「屏幕色仅供参考」。
3. **291 色最近色匹配性能**：160×160 像素 × 291 色 ≈ 7.4M 距离计算，现代浏览器可接受；若卡顿可后续加 palette 空间分区，本任务不做。
4. **商家套装与 range 互斥语义**：UI 需清晰表达「选套装后以套装为准」。
