# 豆子库存 CSV 导入 — Design

## Scope

在现有“豆子库存”Tab 中增加浏览器本地 CSV 解析、导入预览和确认覆盖能力，并新增一个
会话隔离的批量覆盖 API。复用现有 D1 库存表、流水表和库存快照，不增加迁移或运行时依赖。

## CSV Contract

CSV 为“系列 × 数字后缀”的矩阵，和页面库存表格一致：

```csv
系列,1,2,3
A,100,0,
B,,250,40
```

- 第一行第一列必须为 `系列`；后续表头是唯一的正整数后缀，顺序和子集不限。
- 每个后续数据行第一列是唯一的英文字母系列（解析时转大写）。
- 非空交叉单元格映射为 `${series}${column}`，且必须存在于 `MARD_COLORS`。
- 数量单位固定为颗，只接受非负整数；空白忽略，`0` 参与导入并清零。
- 忽略全空行；兼容 UTF-8 BOM、LF/CRLF、RFC 风格双引号和 `""` 转义。
- 重复表头、重复系列、额外非空列、无法闭合的引号或任一非法值均阻断整次导入。
- 文件最大 1 MiB；解析结果最多 291 个非空色号。

## Frontend Architecture

### Pure parser

新增 `src/lib/inventory/csv.ts`：

```ts
type InventoryCsvItem = { code: string; quantity: number }
type InventoryCsvResult = {
  items: InventoryCsvItem[]
  emptyCellCount: number
  errors: string[]
}

parseInventoryCsv(text: string, validCodes: ReadonlySet<string>): InventoryCsvResult
```

解析器无 DOM/React 依赖，先解析 CSV 行列，再验证矩阵和 MARD 色号。错误包含可定位的中文
行列信息；只要 `errors` 非空，UI 不允许提交。

### Inventory UI

在 `InventoryTab.tsx` 的批量录入区域增加：

- 隐藏文件输入与“导入 CSV”按钮，`accept=".csv,text/csv"`；
- 格式示例与“数量单位为颗”的短提示；
- 文件选择后显示文件名、有效色号数、忽略空白数及错误摘要；
- 合法时显示“确认覆盖 N 个色号”，不会在选文件时自动写入；
- 成功后使用服务端返回快照刷新库存，并在流水已展开时重新加载第一页；
- 文件过大、读取失败或解析错误均只显示中文错误，不提交 API。

CSV 文件本身不传到 Worker。客户端只发送派生后的 `{ code, quantity }[]`。

## API Contract

新增 `PUT /api/inventory/import`，继续使用现有 `credentials: include` 和 Session gate。

```ts
// Request
{ items: Array<{ code: string; quantity: number }> }

// Response
InventorySnapshot
```

服务端验证：

- `items` 是 1–291 项数组；
- 请求体及每个条目只允许约定字段，不接收额外元数据；
- `code` 必须是真实 MARD 色号且本批唯一，使用紧凑的服务端色号边界表二次校验；
- `quantity` 是非负整数；
- 不接收文件名、CSV 文本或客户端用户 ID。

失败使用现有 `{ error, message }` 中文 JSON；验证失败不写入任何数据。

## D1 Write Flow

新增 `setQuantities(db, userId, items, reason = 'adjust')`：

1. 为每个导入项构造条件 ledger SQL，在批次内读取该用户旧余额并计算实际差值；
2. 余额改变时写一条 `adjust` ledger，`delta = new - old`，相同值不插入零差值流水；
3. 随后构造覆盖 upsert，设 `touched = 1`；
4. 所有条件 ledger 与 upsert 通过同一次 `db.batch()` 按序提交；
5. 返回当前用户更新后的库存快照。

`userId` 只来自服务端 Session，不能由 CSV 或请求体指定。未变化的数值仍可标记 touched，但不
生成零差值流水。

## Data Flow

```text
Local CSV File
  → File.text() in browser
  → parseInventoryCsv + MARD code validation
  → preview / explicit confirmation
  → PUT /api/inventory/import {items only}
  → session.user.id
  → atomic D1 inventory upserts + adjust ledger
  → InventorySnapshot
  → refresh overview/detail/ledger
```

## Compatibility and Trade-offs

- 保留现有“批量录入”的累加语义；CSV 是独立的覆盖入口。
- CSV 可导入任意合法色号子集，不与当前 UI 范围耦合，避免用户切换范围后文件失效。
- 不新增 `.xlsx` 或第三方 CSV 包；小型状态机足以覆盖所需 CSV 语法并控制包体。
- 不增加数据库迁移，复用已存在但当前未使用的 `adjust` 流水原因。

## Rollback

移除 `/api/inventory/import` 路由、批量覆盖 helper、CSV 解析器和 UI 区块即可；现有库存录入、
校正、扣减、设置和流水数据结构不受影响。
