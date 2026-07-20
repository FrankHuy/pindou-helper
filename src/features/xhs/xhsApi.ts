/** Client helpers for XHS parse API + image save via same-origin proxy. */

export type XhsImageItem = {
  index: number
  width: number
  height: number
  proxyPath: string
}

export type XhsParseResult = {
  title: string
  resolvedUrl: string
  images: XhsImageItem[]
}

export type XhsApiError = {
  error: string
  message: string
}

/** Pull the first http(s) URL from share-card text. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  // Share cards often append Chinese copy immediately after the URL.
  const withoutCjk = match[0].split(/[一-鿿]/u, 1)[0] ?? match[0]
  return withoutCjk.replace(/[),.;!?，。；！？]+$/u, '')
}

function isXhsParseResult(data: unknown): data is XhsParseResult {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  if (typeof record.title !== 'string') return false
  if (!Array.isArray(record.images) || record.images.length === 0) return false
  return record.images.every((item) => {
    if (!item || typeof item !== 'object') return false
    const image = item as Record<string, unknown>
    return (
      typeof image.index === 'number' &&
      typeof image.proxyPath === 'string' &&
      image.proxyPath.startsWith('/api/xhs/image')
    )
  })
}

export async function parseXhsNote(
  input: string,
  signal?: AbortSignal,
): Promise<XhsParseResult> {
  const extracted = extractFirstUrl(input) ?? input.trim()
  const response = await fetch('/api/xhs/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: extracted }),
    signal,
  })

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('服务器返回异常，请稍后重试')
  }

  if (!response.ok) {
    const err = data as XhsApiError
    throw new Error(err.message || '解析失败，请稍后重试')
  }

  if (!isXhsParseResult(data)) {
    throw new Error('服务器返回数据异常，请稍后重试')
  }

  return data
}

function extensionFromContentType(contentType: string | null): string {
  const kind = (contentType ?? '').split(';', 1)[0].trim().toLowerCase()
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return known[kind] ?? 'jpg'
}

/** Download a proxied image as a named file (mobile-friendly blob link). */
export async function saveImage(proxyPath: string, index: number): Promise<void> {
  if (!proxyPath.startsWith('/api/xhs/image')) {
    throw new Error('图片地址无效')
  }
  const response = await fetch(proxyPath)
  if (!response.ok) {
    throw new Error('图片下载失败，请稍后重试')
  }
  const blob = await response.blob()
  const ext = extensionFromContentType(response.headers.get('content-type') ?? blob.type)
  const filename = `xhs-${String(index).padStart(2, '0')}.${ext}`
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
