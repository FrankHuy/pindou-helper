/** Same-origin inventory API client with credentials include. */

import type {
  DeductResponse,
  InventoryEntryItem,
  InventoryEntryUnit,
  InventoryImportItem,
  InventorySnapshot,
  LedgerResponse,
} from '../../lib/inventory/types'

export class InventoryRequestError extends Error {
  error: string
  status: number

  constructor(status: number, error: string, message: string) {
    super(message)
    this.name = 'InventoryRequestError'
    this.status = status
    this.error = error
  }
}

async function parseError(response: Response): Promise<InventoryRequestError> {
  try {
    const data = (await response.json()) as Partial<{ error: string; message: string }>
    return new InventoryRequestError(
      response.status,
      typeof data.error === 'string' ? data.error : 'server_error',
      typeof data.message === 'string' ? data.message : '请求失败',
    )
  } catch {
    return new InventoryRequestError(response.status, 'server_error', '请求失败')
  }
}

async function invFetch<T>(
  path: string,
  init: RequestInit & { json?: Record<string, unknown> } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  let body = init.body
  if (init.json) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }

  const response = await fetch(path, {
    ...init,
    headers,
    body,
    credentials: 'include',
  })

  if (!response.ok) {
    throw await parseError(response)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function fetchInventory(): Promise<InventorySnapshot> {
  return invFetch<InventorySnapshot>('/api/inventory', { method: 'GET' })
}

export async function postEntries(
  unit: InventoryEntryUnit,
  items: InventoryEntryItem[],
): Promise<InventorySnapshot> {
  return invFetch<InventorySnapshot>('/api/inventory/entries', {
    method: 'POST',
    json: { unit, items },
  })
}

export async function setCodeQuantity(code: string, quantity: number): Promise<InventorySnapshot> {
  return invFetch<InventorySnapshot>(`/api/inventory/codes/${encodeURIComponent(code)}`, {
    method: 'PUT',
    json: { quantity },
  })
}

export async function importInventory(items: InventoryImportItem[]): Promise<InventorySnapshot> {
  return invFetch<InventorySnapshot>('/api/inventory/import', {
    method: 'PUT',
    json: { items },
  })
}

export async function deductInventory(
  items: Array<{ code: string; quantity: number }>,
  clientSessionId?: string,
): Promise<DeductResponse> {
  return invFetch<DeductResponse>('/api/inventory/deduct', {
    method: 'POST',
    json: { items, clientSessionId },
  })
}

export async function updateLowStockThreshold(threshold: number): Promise<InventorySnapshot> {
  return invFetch<InventorySnapshot>('/api/inventory/settings', {
    method: 'PUT',
    json: { lowStockThreshold: threshold },
  })
}

export async function fetchLedger(
  limit = 50,
  cursor?: number | null,
): Promise<LedgerResponse> {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (cursor != null) params.set('cursor', String(cursor))
  return invFetch<LedgerResponse>(`/api/inventory/ledger?${params}`, { method: 'GET' })
}
