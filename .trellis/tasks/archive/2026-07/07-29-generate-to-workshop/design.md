# 生成 → 工作间直达 — Design

## Scope

App bead tab → workshop tab：把当前 `BeadPattern` 转成 `WorkshopAnalyzeOutput` 并直接 `phase = 'done'`。

## Architecture

```
[App bead] pattern 就绪
  → 用户点「开始拼图」
  → setWorkshopImport({ pattern, token++ })
  → setTab('workshop')
  → BeadWorkshopTab effect(token):
       result = workshopResultFromGeneratedPattern(pattern)
       phase = 'done'
       清空识别中间态 / 制作会话（同新上传）
```

### Helper

`src/lib/workshop/from-pattern.ts`（或 `analyze.ts`）:

```ts
workshopResultFromGeneratedPattern(pattern: BeadPattern): WorkshopAnalyzeOutput
```

- `mode: 'grid'`
- `pattern`: 浅拷贝 cells / 新 Map counts（避免与生成 tab 共享可变状态）
- `colors`: 由 counts + 单元格 BeadColor 得到 `WorkshopColor[]`（排序同现有）
- `splitY: 0`, `legendFallback: false`
- `image`: 占位 `ImageData(1,1)`（grid 绘制不依赖源图；重新识别在无真实源图时不可用）

### UI

- App：导出按钮旁「开始拼图」（次要样式或 outline，避免抢导出主按钮语义；或主按钮「开始拼图」+ 次要导出——采用 **主：开始拼图，保留现有导出主色，开始拼图用第二主按钮**）。
- Workshop：`importRequest: { token: number; pattern: BeadPattern } | null` + `onImportConsumed`。
- 无 `sourceUrl` 时：侧栏提示「来自拼豆图纸生成」；隐藏分界线；「重新识别」disabled 或提示需先上传。

## Compatibility

- 上传流程不变。
- 库存仅读 `result`。
- 不新增依赖。

## Rollback

去掉按钮与 props；删除 from-pattern helper。
