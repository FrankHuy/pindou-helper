/** D1 helpers for bead inventory: load, additive upsert, set, deduct (clamp-to-0), settings, ledger. */

import { newId } from '../auth/crypto'

export type InventoryRow = {
  code: string
  quantity: number
  touched: number
  updated_at: number
}

export type LedgerRow = {
  id: string
  user_id: string
  code: string
  delta: number
  reason: string
  ref_id: string | null
  created_at: number
}

/** Load all inventory rows for a user. */
export async function loadInventory(db: D1Database, userId: string): Promise<InventoryRow[]> {
  const result = await db
    .prepare('SELECT code, quantity, touched, updated_at FROM user_bead_inventory WHERE user_id = ?')
    .bind(userId)
    .all<InventoryRow>()
  return result.results ?? []
}

/** Load settings row, returning defaults if absent. */
export async function loadSettings(
  db: D1Database,
  userId: string,
): Promise<{ lowStockThreshold: number; updatedAt: number | null }> {
  const row = await db
    .prepare('SELECT low_stock_threshold, updated_at FROM user_inventory_settings WHERE user_id = ?')
    .bind(userId)
    .first<{ low_stock_threshold: number; updated_at: number }>()
  if (!row) return { lowStockThreshold: 100, updatedAt: null }
  return { lowStockThreshold: row.low_stock_threshold, updatedAt: row.updated_at }
}

/** Upsert settings (threshold). */
export async function saveSettings(
  db: D1Database,
  userId: string,
  threshold: number,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO user_inventory_settings (user_id, low_stock_threshold, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET low_stock_threshold = excluded.low_stock_threshold, updated_at = excluded.updated_at`,
    )
    .bind(userId, threshold, now)
    .run()
}

/**
 * Additive batch entry: increase quantity for each code, set touched=1.
 * Writes ledger rows atomically via batch.
 */
export async function addEntries(
  db: D1Database,
  userId: string,
  items: Array<{ code: string; quantity: number }>,
  refId: string | null = null,
): Promise<void> {
  const now = Date.now()
  const statements: D1PreparedStatement[] = []

  for (const item of items) {
    statements.push(
      db
        .prepare(
          `INSERT INTO user_bead_inventory (user_id, code, quantity, touched, updated_at)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT (user_id, code) DO UPDATE SET
             quantity = quantity + excluded.quantity,
             touched = 1,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, item.code, item.quantity, now),
    )
    statements.push(
      db
        .prepare(
          `INSERT INTO user_inventory_ledger (id, user_id, code, delta, reason, ref_id, created_at)
           VALUES (?, ?, ?, ?, 'entry', ?, ?)`,
        )
        .bind(newId(), userId, item.code, item.quantity, refId, now),
    )
  }

  await db.batch(statements)
}

/**
 * Set quantity for a single code (manual correction).
 * Records ledger delta = newQuantity - oldQuantity.
 */
export async function setQuantity(
  db: D1Database,
  userId: string,
  code: string,
  quantity: number,
  refId: string | null = null,
): Promise<void> {
  const now = Date.now()
  // Load current
  const current = await db
    .prepare('SELECT quantity FROM user_bead_inventory WHERE user_id = ? AND code = ?')
    .bind(userId, code)
    .first<{ quantity: number }>()
  const oldQuantity = current?.quantity ?? 0
  const delta = quantity - oldQuantity

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO user_bead_inventory (user_id, code, quantity, touched, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (user_id, code) DO UPDATE SET
           quantity = excluded.quantity,
           touched = 1,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, code, quantity, now),
  ]

  // Only write ledger if there's an actual change
  if (delta !== 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO user_inventory_ledger (id, user_id, code, delta, reason, ref_id, created_at)
           VALUES (?, ?, ?, ?, 'set', ?, ?)`,
        )
        .bind(newId(), userId, code, delta, refId, now),
    )
  }

  await db.batch(statements)
}

export type DeductResult = {
  /** Codes where balance was insufficient before deduct */
  shortages: Array<{ code: string; balance: number; needed: number; deducted: number }>
  /** Updated rows for codes that were touched */
  updated: InventoryRow[]
}

/**
 * Deduct inventory by snapshot items. Clamp each code to 0 (never negative).
 * Returns shortage info for codes where balance < needed.
 * Writes ledger rows with actual deducted amount (may be less than needed).
 */
export async function deductInventory(
  db: D1Database,
  userId: string,
  items: Array<{ code: string; quantity: number }>,
  refId: string | null = null,
): Promise<DeductResult> {
  const now = Date.now()
  const codes = items.map((item) => item.code)

  // Load all relevant rows
  const placeholders = codes.map(() => '?').join(',')
  const rows = await db
    .prepare(
      `SELECT code, quantity, touched, updated_at FROM user_bead_inventory
       WHERE user_id = ? AND code IN (${placeholders})`,
    )
    .bind(userId, ...codes)
    .all<InventoryRow>()

  const balanceMap = new Map<string, number>()
  for (const row of rows.results ?? []) {
    balanceMap.set(row.code, row.quantity)
  }

  const statements: D1PreparedStatement[] = []
  const shortages: Array<{ code: string; balance: number; needed: number; deducted: number }> = []
  const updated: InventoryRow[] = []

  for (const item of items) {
    const balance = balanceMap.get(item.code) ?? 0
    const needed = item.quantity
    const actualDeduct = Math.min(balance, needed)
    const newQuantity = balance - actualDeduct

    if (actualDeduct > 0) {
      statements.push(
        db
          .prepare(
            `INSERT INTO user_bead_inventory (user_id, code, quantity, touched, updated_at)
             VALUES (?, ?, ?, 1, ?)
             ON CONFLICT (user_id, code) DO UPDATE SET
               quantity = excluded.quantity,
               touched = 1,
               updated_at = excluded.updated_at`,
          )
          .bind(userId, item.code, newQuantity, now),
      )
      statements.push(
        db
          .prepare(
            `INSERT INTO user_inventory_ledger (id, user_id, code, delta, reason, ref_id, created_at)
             VALUES (?, ?, ?, ?, 'deduct', ?, ?)`,
          )
          .bind(newId(), userId, item.code, -actualDeduct, refId, now),
      )
      updated.push({ code: item.code, quantity: newQuantity, touched: 1, updated_at: now })
    } else if (needed > 0) {
      // Balance was 0, nothing to deduct but still mark touched
      statements.push(
        db
          .prepare(
            `INSERT INTO user_bead_inventory (user_id, code, quantity, touched, updated_at)
             VALUES (?, ?, 0, 1, ?)
             ON CONFLICT (user_id, code) DO UPDATE SET
               touched = 1,
               updated_at = excluded.updated_at`,
          )
          .bind(userId, item.code, now),
      )
    }

    if (balance < needed) {
      shortages.push({ code: item.code, balance, needed, deducted: actualDeduct })
    }
  }

  await db.batch(statements)
  return { shortages, updated }
}

/** Query ledger entries with cursor pagination (time descending). */
export async function queryLedger(
  db: D1Database,
  userId: string,
  limit: number,
  cursor: number | null,
): Promise<{ entries: LedgerRow[]; nextCursor: number | null }> {
  const actualLimit = Math.min(Math.max(1, limit), 200)

  let query: string
  let bindings: unknown[]
  if (cursor != null) {
    query = `SELECT id, user_id, code, delta, reason, ref_id, created_at
             FROM user_inventory_ledger
             WHERE user_id = ? AND created_at < ?
             ORDER BY created_at DESC
             LIMIT ?`
    bindings = [userId, cursor, actualLimit + 1]
  } else {
    query = `SELECT id, user_id, code, delta, reason, ref_id, created_at
             FROM user_inventory_ledger
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`
    bindings = [userId, actualLimit + 1]
  }

  const result = await db.prepare(query).bind(...bindings).all<LedgerRow>()
  const rows = result.results ?? []
  let nextCursor: number | null = null
  if (rows.length > actualLimit) {
    const last = rows[actualLimit - 1]
    if (last) nextCursor = last.created_at
    rows.length = actualLimit
  }

  return { entries: rows, nextCursor }
}
