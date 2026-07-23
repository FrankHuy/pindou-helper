/**
 * Bead AI image edit — single upstream POST /v1/images/edits per user submit.
 * Worker fetches result URLs and returns same-origin base64; never exposes API key.
 */

import { getConfigBool } from '../db/config'
import { jsonError, jsonOk } from '../auth/http'
import { deductAiUsage, remainingFromSnapshot } from '../guard/deduct'
import { requireAiAccess } from '../guard/requireAiAccess'

export type ImageEditEnv = {
  DB: D1Database
  AI_IMAGE_API_KEY?: string
  AI_IMAGE_BASE_URL?: string
  AI_IMAGE_MODEL?: string
  AI_IMAGE_SIZE?: string
  AI_IMAGE_PROMPT_TEMPLATE?: string
}

const DEFAULT_PROMPT_TEMPLATE =
  '{style}画风, 纯白/绿底. pixel art style, 16-bit, retro game aesthetic, sharp focus, high contrast, clean lines, detailedpixel art, masterpiece, best quality'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

type UpstreamImageItem = {
  url?: string
  b64_json?: string
  b64?: string
}

type UpstreamEditsResponse = {
  data?: UpstreamImageItem[]
  error?: { message?: string; code?: string }
}

function resolvePromptTemplate(env: ImageEditEnv): string {
  const fromEnv = env.AI_IMAGE_PROMPT_TEMPLATE?.trim()
  if (fromEnv && fromEnv.includes('{style}')) return fromEnv
  return DEFAULT_PROMPT_TEMPLATE
}

export function assembleImageEditPrompt(style: string, template = DEFAULT_PROMPT_TEMPLATE): string {
  const safeStyle = style.trim() || 'chibi'
  return template.replaceAll('{style}', safeStyle)
}

function normalizeStyle(raw: FormDataEntryValue | null): { ok: true; style: string } | { ok: false; message: string } {
  if (raw == null || raw === '') return { ok: true, style: 'chibi' }
  if (typeof raw !== 'string') return { ok: false, message: '画风须为文本' }
  const style = raw.trim()
  if (!style) return { ok: true, style: 'chibi' }
  if (style.length > 10) return { ok: false, message: '画风最多 10 个字符' }
  return { ok: true, style }
}

function normalizeN(raw: FormDataEntryValue | null): { ok: true; n: number } | { ok: false; message: string } {
  if (raw == null || raw === '') return { ok: true, n: 1 }
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    return { ok: false, message: '张数须为 1–4 的整数' }
  }
  return { ok: true, n }
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function fetchResultImage(
  url: string,
): Promise<{ mime: string; base64: string } | null> {
  const attempt = async (): Promise<{ mime: string; base64: string } | null> => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*' },
      })
      if (!res.ok) return null
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES * 2) return null
      const headerType = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
      const sniffed = sniffMime(buf)
      const mime =
        sniffed ||
        (headerType.startsWith('image/') ? headerType : null) ||
        'image/png'
      return { mime, base64: uint8ToBase64(buf) }
    } catch {
      return null
    }
  }

  const first = await attempt()
  if (first) return first
  // One GET retry only — never a second edits call.
  return attempt()
}

/**
 * POST /api/ai/image-edit — multipart image + style + n.
 * Exactly one upstream edits call; charge k successful delivered images.
 */
export async function handleAiImageEdit(
  request: Request,
  env: ImageEditEnv,
): Promise<Response> {
  const platformKey = env.AI_IMAGE_API_KEY?.trim() || ''
  const baseUrl = (env.AI_IMAGE_BASE_URL?.trim() || 'https://wisart.kuaileshifu.com').replace(
    /\/+$/,
    '',
  )
  const model = env.AI_IMAGE_MODEL?.trim() || 'gpt-image-2'
  const size = env.AI_IMAGE_SIZE?.trim() || '1024x1024'

  const editEnabled = await getConfigBool(env.DB, 'image_edit_enabled', true)
  if (!editEnabled) {
    return jsonError(503, 'not_configured', 'AI 出图功能已关闭')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError(400, 'invalid_request', '请以 multipart 上传图片')
  }

  // Optional one-shot user key (form only; never logged / never stored).
  const userKeyRaw =
    form.get('api_key') ?? form.get('apiKey') ?? form.get('userApiKey') ?? form.get('user_api_key')
  const userApiKey =
    typeof userKeyRaw === 'string' && userKeyRaw.trim() ? userKeyRaw.trim() : ''
  const useUserKey = Boolean(userApiKey)
  const apiKey = useUserKey ? userApiKey : platformKey

  if (!apiKey) {
    return jsonError(
      503,
      'not_configured',
      'AI 出图服务未配置，或请临时填写你自己的 API Key',
    )
  }

  const styleResult = normalizeStyle(form.get('style'))
  if (!styleResult.ok) return jsonError(400, 'invalid_request', styleResult.message)
  const nResult = normalizeN(form.get('n'))
  if (!nResult.ok) return jsonError(400, 'invalid_request', nResult.message)
  const { style } = styleResult
  const { n } = nResult

  const imageEntry = form.get('image')
  if (!(imageEntry instanceof File) || imageEntry.size <= 0) {
    return jsonError(400, 'invalid_request', '请上传图片文件')
  }
  if (imageEntry.size > MAX_IMAGE_BYTES) {
    return jsonError(400, 'invalid_request', '图片不能超过 8MB')
  }

  const declaredType = (imageEntry.type || '').toLowerCase()
  if (declaredType && !ALLOWED_IMAGE_TYPES.has(declaredType) && !declaredType.startsWith('image/')) {
    return jsonError(400, 'invalid_request', '仅支持 jpg / png / webp / gif')
  }

  const imageBytes = new Uint8Array(await imageEntry.arrayBuffer())
  const sniffed = sniffMime(imageBytes)
  if (!sniffed && declaredType && !ALLOWED_IMAGE_TYPES.has(declaredType)) {
    return jsonError(400, 'invalid_request', '无法识别的图片格式')
  }
  const uploadMime = sniffed || (ALLOWED_IMAGE_TYPES.has(declaredType) ? declaredType : 'image/png')
  const uploadName = imageEntry.name?.trim() || `upload.${uploadMime.split('/')[1] || 'png'}`

  // Fingerprint may be sent as form field when multipart (header X-Client-Fp preferred).
  const fpField = form.get('fingerprint') ?? form.get('fp')
  const bodyForFp: Record<string, unknown> = {}
  if (typeof fpField === 'string' && fpField.trim()) {
    bodyForFp.fingerprint = fpField.trim()
  }

  // User key: still require login/verify/circuit; skip platform image quotas.
  const access = await requireAiAccess(env.DB, request, bodyForFp, {
    units: n,
    skipQuota: useUserKey,
  })
  if (!access.ok) return access.response

  const prompt = assembleImageEditPrompt(style, resolvePromptTemplate(env))

  const upstreamForm = new FormData()
  // Re-wrap bytes so Content-Type is a known image/* (some browsers send empty type).
  upstreamForm.append('image', new File([imageBytes], uploadName, { type: uploadMime }))
  upstreamForm.append('prompt', prompt)
  upstreamForm.append('model', model)
  upstreamForm.append('size', size)
  upstreamForm.append('n', String(n))
  // Prefer URL then worker fetch; some providers also return b64_json.
  upstreamForm.append('response_format', 'url')

  let upstreamJson: UpstreamEditsResponse
  try {
    // Single edits call — no retry on failure.
    const upstreamRes = await fetch(`${baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: upstreamForm,
    })
    const text = await upstreamRes.text()
    try {
      upstreamJson = JSON.parse(text) as UpstreamEditsResponse
    } catch {
      console.info('[ai-image-edit] upstream_non_json', {
        status: upstreamRes.status,
        len: text.length,
      })
      return jsonError(502, 'upstream_failed', '上游图像服务返回异常')
    }
    if (!upstreamRes.ok) {
      const msg = upstreamJson.error?.message?.trim()
      console.info('[ai-image-edit] upstream_http', {
        status: upstreamRes.status,
        message: msg?.slice(0, 120),
      })
      return jsonError(502, 'upstream_failed', msg || '上游图像服务调用失败')
    }
  } catch (err) {
    console.info('[ai-image-edit] upstream_network', {
      err: err instanceof Error ? err.message : 'unknown',
    })
    return jsonError(502, 'upstream_failed', '无法连接上游图像服务')
  }

  const items = Array.isArray(upstreamJson.data) ? upstreamJson.data : []
  if (items.length === 0) {
    return jsonError(502, 'upstream_failed', '上游未返回图片')
  }

  const images: { index: number; mime: string; base64: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const b64 = item.b64_json || item.b64
    if (typeof b64 === 'string' && b64.trim()) {
      images.push({
        index: images.length + 1,
        mime: 'image/png',
        base64: b64.trim(),
      })
      continue
    }
    if (typeof item.url === 'string' && item.url.trim()) {
      const fetched = await fetchResultImage(item.url.trim())
      if (fetched) {
        images.push({
          index: images.length + 1,
          mime: fetched.mime,
          base64: fetched.base64,
        })
      }
    }
  }

  if (images.length === 0) {
    return jsonError(502, 'result_fetch_failed', '生成结果拉取失败，未扣费')
  }

  const charged = useUserKey ? 0 : images.length
  const remainingQuota = useUserKey
    ? access.ctx.quota
    : await deductAiUsage(env.DB, access.ctx, charged)
  const remaining = remainingFromSnapshot(remainingQuota)

  return jsonOk({
    ok: true,
    charged,
    usedUserApiKey: useUserKey,
    remaining: {
      user: remaining.user,
      userLimit: remaining.userLimit,
      global: remaining.global,
      globalLimit: remaining.globalLimit,
    },
    images,
  })
}
