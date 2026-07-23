/** Same-origin bead AI image-edit client (credentials include). */

import { AuthRequestError } from '../auth/authApi'
import { getClientFingerprint } from '../auth/fingerprint'

export type BeadAiImage = {
  index: number
  mime: string
  base64: string
}

export type BeadAiRemaining = {
  user: number
  userLimit: number
  global: number
  globalLimit: number
}

export type BeadAiImageEditResponse = {
  ok: true
  charged: number
  /** True when request used a temporary user-supplied API key (no platform charge). */
  usedUserApiKey?: boolean
  remaining: BeadAiRemaining
  images: BeadAiImage[]
}

async function parseError(response: Response): Promise<AuthRequestError> {
  try {
    const data = (await response.json()) as { error?: string; message?: string }
    return new AuthRequestError(
      response.status,
      typeof data.error === 'string' ? data.error : 'server_error',
      typeof data.message === 'string' ? data.message : '请求失败',
    )
  } catch {
    return new AuthRequestError(response.status, 'server_error', '请求失败')
  }
}

/**
 * POST /api/ai/image-edit — one in-flight request per caller (UI double-submit guard).
 * Never retries automatically.
 */
export async function requestBeadAiImageEdit(input: {
  file: File
  style: string
  n: number
  /** Optional one-shot key; not persisted. When set, platform quota is not charged. */
  apiKey?: string
  signal?: AbortSignal
}): Promise<BeadAiImageEditResponse> {
  const form = new FormData()
  form.append('image', input.file, input.file.name || 'source.png')
  form.append('style', input.style.trim() || 'chibi')
  form.append('n', String(input.n))
  const userKey = input.apiKey?.trim()
  if (userKey) form.append('api_key', userKey)
  const fp = getClientFingerprint()
  form.append('fingerprint', fp)

  const response = await fetch('/api/ai/image-edit', {
    method: 'POST',
    body: form,
    credentials: 'include',
    signal: input.signal,
    headers: {
      'X-Client-Fp': fp,
    },
  })

  if (!response.ok) {
    throw await parseError(response)
  }

  const data = (await response.json()) as BeadAiImageEditResponse
  if (!data?.ok || !Array.isArray(data.images) || data.images.length === 0) {
    throw new AuthRequestError(502, 'upstream_failed', '未返回可用图片')
  }
  return data
}

export function beadAiImageToObjectUrl(image: BeadAiImage): string {
  const binary = atob(image.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: image.mime || 'image/png' })
  return URL.createObjectURL(blob)
}

export async function beadAiImageToFile(image: BeadAiImage, name = 'ai-optimized.png'): Promise<File> {
  const binary = atob(image.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const mime = image.mime || 'image/png'
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
  const fileName = name.includes('.') ? name : `${name.replace(/\.\w+$/, '')}.${ext}`
  return new File([bytes], fileName, { type: mime })
}
