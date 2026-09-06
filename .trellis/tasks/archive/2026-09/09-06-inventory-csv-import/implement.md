# 豆子库存 CSV 导入 — Implementation Plan

## Ordered Checklist

### 1. Pure CSV parsing

- [x] 1.1 Add `src/lib/inventory/csv.ts` with BOM, LF/CRLF, quoted-field, escaped-quote,
  trailing-empty-cell, and malformed-quote handling.
- [x] 1.2 Validate the `系列` matrix header, unique numeric columns, unique series rows,
  non-negative integer quantities, real MARD intersections, 1 MiB input limit, and 291-item cap.
- [x] 1.3 Return an all-or-nothing parse result with Chinese row/column errors and summary counts.

### 2. Atomic import API

- [x] 2.1 Add `setQuantities` to `worker/db/inventory.ts`; use the authenticated `userId`,
  overwrite balances, set touched, and write non-zero `adjust` deltas in the same D1 batch.
- [x] 2.2 Add `handleImportInventory` with session/ban gate and complete payload validation.
- [x] 2.3 Add `PUT /api/inventory/import` before the dynamic `/codes/:code` route.
- [x] 2.4 Add `importInventory` to the credentialed frontend API client and required DTO types.

### 3. Inventory UI

- [x] 3.1 Add a compact CSV import section beside the existing spreadsheet entry flow.
- [x] 3.2 Read and parse `.csv` locally; never upload the original file or filename.
- [x] 3.3 Show format help, selected file summary, validation errors, and explicit confirmation.
- [x] 3.4 On success, refresh the inventory snapshot, clear import state, and reload an open ledger.
- [x] 3.5 Add responsive/theme-compatible styles using existing semantic tokens.

### 4. Validation

- [x] 4.1 Bundle the pure parser and run a temporary Node regression harness covering valid matrix,
  BOM/CRLF, quotes, subsets, blanks, zero, duplicates, unknown codes, invalid numbers, and broken CSV.
- [x] 4.2 Exercise the import handler/DB helper with a mocked session/D1 or equivalent focused harness;
  assert no client user ID is accepted and invalid payloads do not write.
- [x] 4.3 Run `npm run build` and `npm run lint`.
- [x] 4.4 Run `git diff --check` and inspect the full cross-layer diff.
- [ ] 4.5 Manual check: import a valid CSV, verify overwrite/idempotency, inventory summary, current-user
  isolation, `adjust` ledger, invalid-file blocking, narrow mobile layout, light and dark themes.

## Risky Files / Rollback Points

- `src/features/inventory/InventoryTab.tsx`: preserve existing additive entry drafts, filters, and
  keep-alive behavior; CSV state must not interfere with them.
- `worker/db/inventory.ts`: all imported balances and ledger deltas must share one D1 batch.
- `worker/index.ts`: exact import route must precede `/api/inventory/codes/*` routing.
- `src/lib/inventory/csv.ts`: malformed files must fail closed instead of partially importing.

Rollback is a feature-only revert; no migration rollback is needed.
