# 豆子库存管理 — Design

## Scope

Add account-bound bead inventory:

- Frontend: inventory management Tab + workshop start/finish UX + pure math helpers.
- Worker/D1: authoritative inventory storage and mutation APIs behind session auth.
- Workshop sheet images remain local; only color codes and bead counts are synced.

## Architecture

### Frontend modules

- `src/lib/inventory/types.ts`
  - shared domain types for records, deltas, snapshots, shortages, low-stock items, API DTOs.
- `src/lib/inventory/math.ts`
  - pure conversion and calculation: grams→beads, shortage, low-stock, snapshot from workshop colors.
- `src/features/inventory/inventoryApi.ts`
  - same-origin credentialed client for inventory endpoints (mirror `authApi` style).
- `src/features/inventory/InventoryTab.tsx`
  - palette selector, spreadsheet entry grid, overview, filters, manual correction.
- `src/features/inventory/inventory.css`
  - feature-scoped styles with `inventory-` prefix.

### Worker / DB modules

- `migrations/0003_bead_inventory.sql`
  - `user_bead_inventory`, `user_inventory_settings`, and `user_inventory_ledger` tables.
- `worker/db/inventory.ts` (or `worker/inventory/store.ts`)
  - D1 load/upsert/add/deduct helpers + ledger insert (batched with balance mutation).
- `worker/inventory/handlers.ts`
  - HTTP handlers with session gate and Chinese error messages.
- `worker/index.ts`
  - route `/api/inventory*`.

### Existing modules to update

- `src/App.tsx`
  - extend `AppTab` with `inventory`.
  - load inventory when session user is present; clear on logout.
  - pass inventory snapshot + mutators into Inventory/Workshop tabs.
- `src/features/workshop/BeadWorkshopTab.tsx`
  - start/end controls, shortage/low-stock panels, locked usage snapshot.
- `.trellis/spec/frontend/*` after implementation if durable conventions emerge.

## Auth Gate

Reuse existing session stack:

1. `resolveSessionUser(env.DB, request)`
2. if missing → `401 auth_required`
3. if `user.banned_at` → `403 banned`
4. **login required, email verification not required** for inventory (confirmed by Q4); email verification gate stays on AI image edit routes only.
- Low-stock threshold: per-user global value in `user_inventory_settings`, default `100` beads; editable via `PUT /api/inventory/settings`.

Frontend:

- Inventory tab and workshop inventory actions check `sessionUser`.
- Missing session → Chinese login CTA using existing shell navigation to `/login`.

## Data Model (D1)

```sql
CREATE TABLE IF NOT EXISTS user_bead_inventory (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  touched INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_user_bead_inventory_user
  ON user_bead_inventory (user_id);

CREATE TABLE IF NOT EXISTS user_inventory_settings (
  user_id TEXT PRIMARY KEY NOT NULL,
  low_stock_threshold INTEGER NOT NULL DEFAULT 100,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
```

Rules:

- `quantity` is whole beads, never negative.
- `touched = 1` after any user edit or workshop deduction affecting that code.
- `low_stock_threshold` is a per-user global value (default 100); low-stock evaluation compares `quantity < threshold`.
- Low-stock evaluation uses settings threshold + `touched = 1` (or codes present in finish snapshot).
- No full 291-row prefill; sparse rows only.

Ledger (confirmed by Q3 — required in MVP):

```sql
CREATE TABLE IF NOT EXISTS user_inventory_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL, -- entry | set | deduct | adjust
  ref_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_ledger_user_time
  ON user_inventory_ledger (user_id, created_at DESC);
```

Ledger rules:
- One row per mutation per code; `delta` signed (positive add, negative deduct); `set`/`adjust` store difference from old to new quantity.
- Written inside the same D1 batch as the balance upsert/deduct so they succeed or fail atomically.
- `ref_id`可用于未来会话关连（如工作间结束的 clientSessionId）。
- MVP 提供查询分页（近期条倒序）；不支持删除/编辑流水。
- 图表/趋势/Top 消耗色号等分析能力不纳入本 MVP，留待后续迭代。

## API Contracts

All mutating routes: `credentials: include`, session cookie.

### `GET /api/inventory`

Response:

```ts
{
  records: Array<{ code: string; quantity: number; touched: boolean; updatedAt: number }>
  lowStockThreshold: number
  updatedAt: number | null
}
```

### `POST /api/inventory/entries`

Additive batch entry.

```ts
// request
{ unit: 'bead' | 'gram'; items: Array<{ code: string; value: number }> }
// response: same shape as GET after mutation
```

Server converts grams with `Math.round(value * 100)` and rejects negative/non-finite values and unknown empty codes.

### `PUT /api/inventory/codes/:code`

Direct set correction.

```ts
{ quantity: number } // integer >= 0
```

### `POST /api/inventory/deduct`

Workshop finish.

```ts
{
  items: Array<{ code: string; quantity: number }> // locked snapshot needs
  clientSessionId?: string // optional idempotency key for later hardening
}
```

Server:

1. load current rows
2. for each item, subtract `quantity` from balance; **clamp to 0** (never negative)
3. mark touched and write ledger rows (delta = actual subtracted amount, which may be less than requested if balance was insufficient)
4. return updated inventory + lowStock items for used codes + **shortage list** (codes where balance was insufficient before deduct)

**No 409 rejection** — deduct always succeeds; shortage is informational only.
2

### `PUT /api/inventory/settings`

Per-user global threshold.

```ts
{ lowStockThreshold: number } // integer >= 0
```

### `GET /api/inventory/ledger`

Recent ledger entries (MVP: simple time-descending list).

```ts
// query: ?limit=50&cursor=<createdAt>
{
  entries: Array<{
    id: string
    code: string
    delta: number
    reason: 'entry' | 'set' | 'deduct' | 'adjust'
    refId: string | null
    createdAt: number
  }>
  nextCursor: number | null
}
```

Only entries for the authenticated user; no write/delete/edit endpoints in MVP.

## Frontend State Flow

```
sessionUser
  ├─ null → inventory UI login gate; workshop start/end disabled with CTA
  └─ user
       ├─ GET /api/inventory on login / tab focus / after mutations
       ├─ InventoryTab: local draft entry grid → POST entries / PUT code
       └─ Workshop:
            start: local shortage calc from cached inventory + result.colors
            finish: POST deduct with locked snapshot → refresh inventory
```

No Redux/Zustand. Shell or inventory feature owns cloud-backed state and passes props, consistent with current no-global-store guideline.

## Palette Grid Contract

- Rows = color `series`, columns = numeric suffix of `code`.
- Cell exists only if selected scope contains that code.
- Selection reuses `resolvePalette` + `MARD_PACK_SIZES` / range options.
- Entry unit toggle: 颗 / g; display always shows current balance in 颗.

## Workshop Flow

1. Recognize sheet locally as today.
2. Start builds `InventoryUsageSnapshot` from `result.colors` (`count > 0`).
3. Compare against latest loaded cloud inventory.
4. Shortages → **warn but allow user to proceed** (no block).
5. User confirms → lock snapshot in component state (`activeSession`).
6. Finish → `POST /api/inventory/deduct` with locked snapshot.
7. On success, clear active session, show low-stock list + any shortage reminder from response.
8. Re-recognize while active does not change locked snapshot; show Chinese warning.

## Concurrency / Multi-device

- Server balances are authoritative.
- Additive entries and set corrections are row-level upserts.
- Finish deduct clamps each code to 0 (never negative); shortage is returned as informational, not a 409 error.
- No CRDT in MVP.

## Compatibility

- New D1 migration only; no change to auth schema semantics.
- Existing AI quota / XHS / bead generate untouched except App tab wiring.
- Privacy: sheet bytes never leave the browser.

## Trade-offs

| Choice | Pros | Cons |
|--------|------|------|
| Cloud D1 balances | Cross-device, account-bound | Requires login; offline write deferred |
| Sparse rows | Cheap storage | Need touched flag for low-stock filtering |
| Clamp-to-zero deduct | User never blocked; simple | Multi-device double-spend can silently over-consume, but balances never go negative |

## Rollback

1. Remove `/api/inventory*` routes and inventory worker modules.
2. Keep migration table inert or drop in a follow-up migration if needed.
3. Remove inventory Tab and workshop start/end UI.
4. Frontend without routes simply loses feature; no auth breakage.
