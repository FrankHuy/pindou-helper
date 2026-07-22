/** Stub AI routes for end-to-end guard testing. */

import { jsonOk, readJsonBody } from '../auth/http'
import { deductAiUsage, remainingFromSnapshot } from './deduct'
import { requireAiAccess } from './requireAiAccess'

export type GuardWorkerEnv = {
  DB: D1Database
}

/**
 * POST /api/ai/ping — auth + quota gate, then bill one unit on success.
 * Body may include fingerprint; header X-Client-Fp preferred.
 */
export async function handleAiPing(request: Request, env: GuardWorkerEnv): Promise<Response> {
  // Body is optional; empty body is fine for curl tests.
  let body: Record<string, unknown> | undefined
  const contentType = request.headers.get('Content-Type') || ''
  if (contentType.includes('application/json')) {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response
    body = parsed.body
  }

  const access = await requireAiAccess(env.DB, request, body)
  if (!access.ok) return access.response

  // Billable stub success — no upstream provider in Phase 1.
  const remainingQuota = await deductAiUsage(env.DB, access.ctx)
  const remaining = remainingFromSnapshot(remainingQuota)

  return jsonOk({
    ok: true,
    message: 'AI 护栏探测成功',
    remaining,
  })
}
