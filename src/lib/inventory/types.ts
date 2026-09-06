/** Shared domain types for inventory feature. */

export type InventoryRecord = {
  code: string
  quantity: number
  touched: boolean
  updatedAt: number
}

export type InventorySnapshot = {
  records: InventoryRecord[]
  lowStockThreshold: number
  updatedAt: number | null
}

export type InventoryEntryUnit = 'bead' | 'gram'

export type InventoryEntryItem = {
  code: string
  value: number
}

export type InventoryImportItem = {
  code: string
  quantity: number
}

export type InventoryImportMode = 'add' | 'replace'

export type ShortageItem = {
  code: string
  balance: number
  needed: number
  gap: number
}

export type LowStockItem = {
  code: string
  quantity: number
  threshold: number
}

export type UsageSnapshotItem = {
  code: string
  quantity: number
}

export type InventoryUsageSnapshot = {
  items: UsageSnapshotItem[]
  createdAt: number
}

export type LedgerEntry = {
  id: string
  code: string
  delta: number
  reason: 'entry' | 'set' | 'deduct' | 'adjust'
  refId: string | null
  createdAt: number
}

export type LedgerResponse = {
  entries: LedgerEntry[]
  nextCursor: number | null
}

export type DeductResponse = InventorySnapshot & {
  shortages: Array<{ code: string; balance: number; needed: number; deducted: number }>
}
