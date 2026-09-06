# 库存 CSV 导入模式选择 — Design

## Scope

在现有库存 CSV 预览中增加“新增 / 覆盖”模式选择，并让同一个导入 API 根据显式模式复用
现有累加或覆盖写入路径。CSV 解析、MARD 校验、Session 隔离和响应快照保持不变。

## Frontend State and UX

新增领域类型：

```ts
type InventoryImportMode = 'add' | 'replace'
```

`InventoryTab` 持有 `csvMode`，默认值为 `add`。以下事件都重置为 `add`：

- 重新选择任意 CSV 文件，包括读取或校验失败；
- 切换 `sessionUser.id`；
- 取消当前导入预览。

合法预览中显示分段按钮和随模式变化的说明：

- `add`：导入数量累加到已有库存；数量 `0` 不改变库存；
- `replace`：导入数量替换已有库存；数量 `0` 清零，并使用警示色。

确认按钮分别显示“确认新增 N 个色号”和“确认覆盖 N 个色号”。新增模式的 N 只计算
大于 0 的条目；如果文件非空值全部为 0，则不显示确认按钮并提示没有可新增数量。无需二次弹窗。

## API Contract

保持 `PUT /api/inventory/import`，请求扩展为：

```ts
{
  mode: 'add' | 'replace'
  items: Array<{ code: string; quantity: number }>
}
```

- 新客户端必须发送 `mode`。
- 为兼容部署前已打开的旧页面，缺少 `mode` 的旧请求按原行为解释为 `replace`；未知值拒绝。
- 请求体只允许 `mode` 和 `items`，条目仍只允许 `code` 和 `quantity`。
- `items` 仍为 1–291 个唯一真实 MARD 色号，数量为非负安全整数。
- `userId` 只取当前服务端 Session；响应仍为 `InventorySnapshot`。

## D1 Write Flow

### Add mode

过滤数量为 0 的条目；剩余条目复用 `addEntries(db, session.user.id, items)`：

1. upsert 使用 `quantity = quantity + excluded.quantity`；
2. 每个正数条目写 `entry` ledger，delta 等于 CSV 数量；
3. 所有 upsert 与 ledger 在一个 `db.batch()` 中提交；
4. 若全部为 0，则不调用 `db.batch()`，直接返回当前快照。

### Replace mode

继续使用 `setQuantities(db, session.user.id, items)`：条件 `adjust` ledger 在批次内读取旧余额并
记录 `new - old`，随后覆盖 upsert；`0` 清零，相同数值不生成零差值流水。

## Data Flow

```text
Local CSV → parse/preview → select add|replace → explicit confirmation
  → PUT /api/inventory/import {mode, items}
  → Session user
  ├─ add: positive items → addEntries → entry ledger
  └─ replace: all items → setQuantities → adjust ledger
  → InventorySnapshot → refresh inventory and open ledger
```

## Compatibility and Trade-offs

- 不改变 CSV 文件格式，用户无需重做现有文件。
- 缺失模式仅作为旧客户端兼容分支保留 `replace`；新 UI 永远显式发送模式。
- 不新增流水枚举或数据库迁移：新增复用 `entry`，覆盖复用 `adjust`。
- 模式不持久化到 localStorage，优先降低误覆盖风险。

## Rollback

移除前端模式状态和请求 `mode`，并让 handler 固定走 `setQuantities`，即可恢复现有覆盖行为；
无需回滚数据库。
