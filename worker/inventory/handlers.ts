/** Inventory HTTP handlers: session gate + Chinese error messages. */

import { jsonError, jsonOk, readJsonBody } from '../auth/http'
import { resolveSessionUser, type SessionUser } from '../auth/session'
import {
  addEntries,
  deductInventory,
  loadInventory,
  loadSettings,
  queryLedger,
  saveSettings,
  setQuantity,
  type InventoryRow,
} from '../db/inventory'

async function requireSession(
  db: D1Database,
  request: Request,
): Promise<SessionUser | Response> {
  const sessionUser = await resolveSessionUser(db, request)
  if (!sessionUser) {
    return jsonError(401, 'auth_required', '请先登录')
  }
  if (sessionUser.user.banned_at != null) {
    return jsonError(403, 'banned', sessionUser.user.ban_reason?.trim() || '账号已被封禁')
  }
  return sessionUser
}

function toInventoryResponse(
  records: InventoryRow[],
  lowStockThreshold: number,
  updatedAt: number | null,
) {
  return {
    records: records.map((r) => ({
      code: r.code,
      quantity: r.quantity,
      touched: r.touched === 1,
      updatedAt: r.updated_at,
    })),
    lowStockThreshold,
    updatedAt,
  }
}

/** GET /api/inventory */
export async function handleGetInventory(
  request: Request,
  env: { DB: D1Database },
): Promise<Response> {
  const session = await requireSession(env.DB, request)
  if (session instanceof Response) return session

  const [records, settings] = await Promise.all([
    loadInventory(env.DB, session.user.id),
    loadSettings(env.DB, session.user.id),
  ])

  return jsonOk(toInventoryResponse(records, settings.lowStockThreshold, settings.updatedAt))
}

/** POST /api/inventory/entries — additive batch entry */
export async function handleAddEntries(
  request: Request,
  env: { DB: D1Database },
): Promise<Response> {
  const session = await requireSession(env.DB, request)
  if (session instanceof Response) return session

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const unit = parsed.body.unit
  const rawItems = parsed.body.items

  if (!Array.isArray(rawItems)) {
    return jsonError(400, 'invalid_request', 'items 必须是数组')
  }
  if (unit !== 'bead' && unit !== 'gram') {
    return jsonError(400, 'invalid_request', 'unit 必须是 bead 或 gram')
  }

  const items: Array<{ code: string; quantity: number }> = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const code = typeof item.code === 'string' ? item.code.trim() : ''
    const value = typeof item.value === 'number' ? item.value : NaN

    if (!code) continue
    if (!Number.isFinite(value) || value <= 0) continue

    const quantity = unit === 'gram' ? Math.round(value * 100) : Math.round(value)
    if (quantity <= 0 || !Number.isFinite(quantity)) continue

    items.push({ code, quantity })
  }

  if (items.length === 0) {
    return jsonError(400, 'invalid_request', '没有有效的录入条目')
  }

  await addEntries(env.DB, session.user.id, items)

  // Return updated inventory
  const [records, settings] = await Promise.all([
    loadInventory(env.DB, session.user.id),
    loadSettings(env.DB, session.user.id),
  ])
  return jsonOk(toInventoryResponse(records, settings.lowStockThreshold, settings.updatedAt))
}

/** PUT /api/inventory/codes/:code — set quantity (manual correction) */
export async function handleSetQuantity(
  request: Request,
  env: { DB: D1Database },
  code: string,
): Promise<Response> {
  const session = await requireSession(env.DB, request)
  if (session instanceof Response) return session

  const trimmedCode = code.trim()
  if (!trimmedCode) {
    return jsonError(400, 'invalid_request', '缺少色号')
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const rawQty = parsed.body.quantity
  if (typeof rawQty !== 'number' || !Number.isFinite(rawQty) || rawQty < 0 || !Number.isInteger(rawQty)) {
    return jsonError(400, 'invalid_request', '库存数量必须是 ≥ 0 的整数')
  }

  await setQuantity(env.DB, session.user.id, trimmedCode, rawQty)

  const [records, settings] = await Promise.all([
    loadInventory(env.DB, session.user.id),
    loadSettings(env.DB, session.user.id),
  ])
  return jsonOk(toInventoryResponse(records, settings.lowStockThreshold, settings.updatedAt))
}

/** POST /api/inventory/deduct — workshop finish (clamp to 0) */
export async function handleDeduct(
  request: Request,
  env: { DB: D1Database },
): Promise<Response> {
  const session = await requireSession(env.DB, request)
  if (session instanceof Response) return session

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const rawItems = parsed.body.items
  const clientSessionId =
    typeof parsed.body.clientSessionId === 'string' ? parsed.body.clientSessionId.trim() : null

  if (!Array.isArray(rawItems)) {
    return jsonError(400, 'invalid_request', 'items 必须是数组')
  }

  const items: Array<{ code: string; quantity: number }> = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const code = typeof item.code === 'string' ? item.code.trim() : ''
    const quantity = typeof item.quantity === 'number' ? Math.round(item.quantity) : 0

    if (!code || quantity <= 0 || !Number.isFinite(quantity)) continue
    items.push({ code, quantity })
  }

  if (items.length === 0) {
    return jsonError(400, 'invalid_request', '没有需要扣减的条目')
  }

  const result = await deductInventory(env.DB, session.user.id, items, clientSessionId)

  // Return updated inventory + shortage info
  const [records, settings] = await Promise.all([
    loadInventory(env.DB, session.user.id),
    loadSettings(env.DB, session.user.id),
  ])

  return jsonOk({
    ...toInventoryResponse(records, settings.lowStockThreshold, settings.updatedAt),
    shortages: result.shortages,
  })
}

/** PUT /api/inventory/settings — per-user global threshold */
export async function handleUpdateSettings(
  request: Request,
  env: { DB: D1Database },
): Promise<Response> {
  const session = await requireSession(env.DB, request)
  if (session instanceof Response) return session

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const raw = parsed.body.lowStockThreshold
  const threshold = raw === undefined ? parsed.body.low_stock_threshold : raw
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    !Number.isInteger(threshold)
  ) {
    return jsonError(400, 'invalid_request', '阈值必须是 ≥ 0 的整数')
  }

  await saveSettings(env.DB, session.user.id, threshold)

  const [records, settings] = await Promise.all([
    loadInventory(env.DB, session.user.id),
    loadSettings(env.DB, session.user.id),
  ])
  return jsonOk(toInventoryResponse(records, settings.lowStockThreshold, settings.updatedAt))
}

/** GET /api/inventory/ledger — recent entries, cursor pagination */
export async function handleGetLedger(
  request: Request,
  env: { DB: D1Database },
): Promise<Response> {
  const session = await requireSession(env.DB, request)
  if (session instanceof Response) return session

  const url = new URL(request.url)
  const limitParam = url.searchParams.get('limit')
  const cursorParam = url.searchParams.get('cursor')

  const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10) || 50)) : 50
  const cursor = cursorParam ? parseInt(cursorParam, 10) : null

  const { entries, nextCursor } = await queryLedger(env.DB, session.user.id, limit, cursor)

  return jsonOk({
    entries: entries.map((e) => ({
      id: e.id,
      code: e.code,
      delta: e.delta,
      reason: e.reason,
      refId: e.ref_id,
      createdAt: e.created_at,
    })),
    nextCursor,
  })
}
