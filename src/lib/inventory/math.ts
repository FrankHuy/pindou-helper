/** Pure inventory math: conversion, shortage, low-stock, snapshot. */

import type { WorkshopColor } from '../workshop/types'
import type {
  InventoryRecord,
  InventorySnapshot,
  InventoryUsageSnapshot,
  LowStockItem,
  ShortageItem,
  UsageSnapshotItem,
} from './types'

const BEADS_PER_GRAM = 100

/** Convert gram value to bead count. */
export function gramsToBeads(grams: number): number {
  return Math.round(grams * BEADS_PER_GRAM)
}

/** Convert beads to gram (display helper, rounds to 0.01g). */
export function beadsToGrams(beads: number): number {
  return Math.round((beads / BEADS_PER_GRAM) * 100) / 100
}

/** Build a usage snapshot from workshop colors (count > 0 only). */
export function buildUsageSnapshot(colors: WorkshopColor[]): InventoryUsageSnapshot {
  const items: UsageSnapshotItem[] = colors
    .filter((c) => c.count > 0)
    .map((c) => ({ code: c.code, quantity: c.count }))
    .sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code, undefined, { numeric: true }))
  return { items, createdAt: Date.now() }
}

/** Convert snapshot to items map for quick lookup. */
export function snapshotToMap(snapshot: InventoryUsageSnapshot | null): Map<string, number> {
  const map = new Map<string, number>()
  if (!snapshot) return map
  for (const item of snapshot.items) map.set(item.code, item.quantity)
  return map
}

/** Convert records array to code→quantity map. */
export function recordsToMap(records: InventoryRecord[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of records) map.set(r.code, r.quantity)
  return map
}

/** Calculate shortages: codes where balance < needed. */
export function calculateShortages(
  inventory: Map<string, number>,
  snapshot: InventoryUsageSnapshot,
): ShortageItem[] {
  const shortages: ShortageItem[] = []
  for (const item of snapshot.items) {
    const balance = inventory.get(item.code) ?? 0
    if (balance < item.quantity) {
      shortages.push({
        code: item.code,
        balance,
        needed: item.quantity,
        gap: item.quantity - balance,
      })
    }
  }
  return shortages.sort((a, b) => b.gap - a.gap || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/**
 * Calculate low-stock items: touched codes (or snapshot codes) where quantity < threshold.
 * Only considers codes that have been touched or are in the snapshot.
 */
export function calculateLowStock(
  snapshot: InventorySnapshot,
  usedCodes?: Set<string>,
): LowStockItem[] {
  const threshold = snapshot.lowStockThreshold
  const lowStock: LowStockItem[] = []

  for (const record of snapshot.records) {
    if (!record.touched) continue
    if (usedCodes && !usedCodes.has(record.code)) continue
    if (record.quantity < threshold) {
      lowStock.push({ code: record.code, quantity: record.quantity, threshold })
    }
  }

  // Also check snapshot codes that may not have inventory rows yet
  if (usedCodes) {
    const existingCodes = new Set(snapshot.records.map((r) => r.code))
    for (const code of usedCodes) {
      if (existingCodes.has(code)) continue
      // No inventory row means quantity 0
      if (threshold > 0) {
        lowStock.push({ code, quantity: 0, threshold })
      }
    }
  }

  return lowStock.sort((a, b) => a.quantity - b.quantity || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/** Get total bead count across all records. */
export function totalBeads(records: InventoryRecord[]): number {
  return records.reduce((sum, r) => sum + r.quantity, 0)
}

/** Count touched codes. */
export function touchedCount(records: InventoryRecord[]): number {
  return records.filter((r) => r.touched).length
}

/** Count low-stock touched codes. */
export function lowStockCount(snapshot: InventorySnapshot): number {
  return calculateLowStock(snapshot).length
}
