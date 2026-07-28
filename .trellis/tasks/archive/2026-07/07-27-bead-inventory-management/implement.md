# 豆子库存管理 — Implementation Plan

## Ordered Checklist

### 1. D1 schema + Worker inventory core

- [x] 1.1 Add `migrations/0003_bead_inventory.sql` with `user_bead_inventory`, `user_inventory_settings`, and `user_inventory_ledger` tables.
- [x] 1.2 Add D1 helpers for load inventory, additive upsert, set quantity, all-or-nothing deduct, settings get/set, ledger insert (batched atomically with balance mutation), and ledger query (cursor pagination).
- [x] 1.3 Add `worker/inventory/handlers.ts` with session gate (`resolveSessionUser`), ban check, Chinese `jsonError` messages.
- [x] 1.4 Wire routes in `worker/index.ts`:
  - `GET /api/inventory`
  - `POST /api/inventory/entries`
  - `PUT /api/inventory/codes/:code`
  - `POST /api/inventory/deduct`
  - `PUT /api/inventory/settings` (per-user global threshold)
  - `GET /api/inventory/ledger` (recent entries, cursor pagination)
- [x] 1.5 Validate grams conversion and non-negative integer constraints on server.

### 2. Frontend inventory domain + API client

- [x] 2.1 Add `src/lib/inventory/types.ts` and `math.ts` (grams, shortages, low-stock, snapshot).
- [x] 2.2 Add `src/features/inventory/inventoryApi.ts` with credentials include, mirror auth error handling.
- [x] 2.3 Add load/refresh helpers usable by App shell and InventoryTab.

### 3. Inventory management Tab

- [x] 3.1 Add `InventoryTab.tsx` + `inventory.css`.
- [x] 3.2 Palette scope selector reusing existing range/pack configuration.
- [x] 3.3 Spreadsheet grid: series rows × numeric columns; only real codes editable.
- [x] 3.4 Additive batch entry in 颗/g; submit via `POST /api/inventory/entries`.
- [x] 3.5 Overview + series/low-stock filters + single-code correction via `PUT`.
- [x] 3.5.1 Threshold setting UI + `PUT /api/inventory/settings`.
- [x] 3.5.2「流水」折叠区：`GET /api/inventory/ledger`，按时间倒序展示条目（色号、增减、原因、时间）；不支持删除/编辑。
- [x] 3.6 Login gate CTA when `sessionUser` is null; loading/error banners in Chinese.

### 4. App shell integration

- [x] 4.1 Extend `AppTab` with `inventory` and Tab label「豆子库存」.
- [x] 4.2 Keep inventory host mounted with `is-hidden` if draft entry state should survive switches.
- [x] 4.3 Fetch inventory when session becomes available; clear on logout.
- [x] 4.4 Pass inventory + mutators into Inventory/Workshop; update header subtitle.

### 5. Workshop start/end

- [x] 5.1 Add start/end UI to `BeadWorkshopTab`.
- [x] 5.2 Start: snapshot from `result.colors`, local shortage against loaded inventory; **warn but allow starting** (no block).
- [x] 5.3 Lock snapshot while in progress; warn that re-recognize does not change finish usage.
- [x] 5.4 Finish: `POST /api/inventory/deduct`; server clamps to 0 (never negative); show low-stock list + shortage reminder from response (no 409 blocking).
- [x] 5.5 Disable start/end when logged out or no recognition result.

### 6. Validation and review

- [x] 6.1 `npm run build`
- [x] 6.2 `npm run lint`
- [ ] 6.3 Manual: login → enter 1g on a code → reload / second browser session sees +100.
- [ ] 6.4 Manual: unauthenticated inventory/workshop actions only show login guidance.
- [ ] 6.5 Manual: workshop start shortage warning (can still start); finish deduct clamps to 0; low-stock prompt.
- [ ] 6.6 Manual: bead generate / workshop highlight / XHS still work; sheet images not uploaded.

## Risky Files / Rollback Points

- `worker/index.ts` and new inventory handlers: keep auth/XHS/AI routes untouched.
- `src/App.tsx`: surgical tab + inventory wiring only.
- `src/features/workshop/BeadWorkshopTab.tsx`: preserve decode/analyze retry contract from workshop spec.
- Rollback after steps 1–3: feature can be hidden without workshop changes.
- Rollback after step 5: remove start/end only; inventory Tab can remain.

## Review Gates Before `task.py start`

- [x] Storage: cloud / account-bound D1 (user confirmed).
- [x] Q2 low-stock threshold model (global per-user, default 100).
- [x] Q3 ledger/history in MVP (yes: writes + simple list view; charts later).
- [x] Q4 email verification required for inventory writes? (confirmed: login-only, no verification needed).
- [x] PRD convergence pass after remaining answers.
- [x] `implement.jsonl` / `check.jsonl` curated with real specs.
