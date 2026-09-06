# 库存 CSV 导入模式选择 — Implementation Plan

## Ordered Checklist

### 1. Shared contract and API

- [x] 1.1 Add `InventoryImportMode = 'add' | 'replace'` to inventory types.
- [x] 1.2 Change `importInventory` to send `{ mode, items }` while preserving credentials.
- [x] 1.3 Extend `handleImportInventory` strict validation to accept known modes, treat a missing mode
  as legacy `replace`, and reject unknown or extra fields without writing.

### 2. Atomic mode-specific writes

- [x] 2.1 Route `add` to existing `addEntries` after filtering zero quantities; all-zero import skips
  `db.batch()` and returns the unchanged current-user snapshot.
- [x] 2.2 Keep `replace` on `setQuantities`, including zero-clearing and conditional `adjust` deltas.
- [x] 2.3 Verify both branches derive user ID exclusively from Session and preserve one-batch inventory
  plus ledger writes.

### 3. Safe mode selection UI

- [x] 3.1 Add local `csvMode`, defaulting to `add`, and reset it on new file, cancel, or account switch.
- [x] 3.2 Add accessible “新增 / 覆盖” segmented controls to a valid CSV preview.
- [x] 3.3 Show mode-specific semantics, warning treatment for overwrite, effective item count, and matching
  confirmation/success text; disable additive confirmation when every quantity is zero.
- [x] 3.4 Add compact responsive light/dark styles using existing semantic tokens.

### 4. Validation and knowledge capture

- [x] 4.1 Extend focused handler/D1 harness for add, replace, legacy missing mode, unknown mode, zero-only,
  session isolation, ledger reason/delta, and invalid-payload no-write behavior.
- [x] 4.2 Run existing CSV parser regression and MARD catalog parity harnesses unchanged.
- [x] 4.3 Run `npm run build`, `npm run lint`, and `git diff --check`; inspect the full cross-layer diff.
- [x] 4.4 Update inventory CSV code-spec with the two-mode request and write contracts.
- [ ] 4.5 Manually check valid preview, mode switch, add/replace results, zero handling, mobile layout, and
  both themes when a local authenticated environment is available.

## Risky Files / Rollback Points

- `src/features/inventory/InventoryTab.tsx`: mode resets must not erase the parsed preview unexpectedly;
  button counts and copy must match the exact submitted items.
- `worker/inventory/handlers.ts`: legacy missing mode is replace-only; unknown modes and extra fields fail closed.
- `worker/db/inventory.ts`: reuse current helpers; do not fork additive SQL or weaken atomic ledger behavior.
- No parser or migration change is expected. Rollback is a feature-only revert.
