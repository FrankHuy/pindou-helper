import { isAllowedImageTarget, normalizeImageUrl } from './allowlist'
import { fetchWithAllowedRedirects } from './redirect'
import { UA, XHS_REFERER, type XhsErrorBody } from './types'

function jsonError(status: number, error: XhsErrorBody['error'], message: string): Response {
  const body: XhsErrorBody = { error, message }
  return Response.json(body, { status })
}

/**
 * Detect image format from magic bytes when upstream Content-Type is wrong
 * (common for bare sns-img originals: application/octet-stream + HEIC).
 */
export function sniffImageContentType(data: ArrayBuffer | Uint8Array): string | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 12) return null

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // GIF
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WEBP: RIFF....WEBP
  if (
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
  // ISO-BMFF brands: ftyp + brand at offset 4..12
  // AVIF / HEIC / HEIF containers.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') {
      return 'image/heic'
    }
    if (brand === 'heif' || brand === 'mif1' || brand === 'msf1') {
      return 'image/heif'
    }
  }
  return null
}

/** GET /api/xhs/image?u=<encoded-cdn-url> — same-origin proxy with Referer. */
export async function proxyImage(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const raw = url.searchParams.get('u')
  if (!raw) {
    return jsonError(400, 'invalid_url', '缺少图片地址参数')
  }

  // URLSearchParams.get() already decodes one layer; decoding again can corrupt
  // signed CDN URLs that legitimately contain encoded path/query characters.
  const target = normalizeImageUrl(raw)
  if (!target) {
    return jsonError(400, 'invalid_url', '图片域名不在允许列表中')
  }

  try {
    const upstream = await fetchWithAllowedRedirects(
      target,
      {
        headers: {
          'User-Agent': UA,
          Referer: XHS_REFERER,
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      },
      isAllowedImageTarget,
    )

    if (!upstream.ok) {
      return jsonError(
        502,
        'upstream_failed',
        `图片获取失败（${upstream.status}），请稍后重试`,
      )
    }

    const declared = (upstream.headers.get('content-type') ?? '').split(';', 1)[0].trim()
    const declaredLower = declared.toLowerCase()

    // Fast path: declared image/* — stream without buffering.
    if (declaredLower.startsWith('image/')) {
      const headers = new Headers({
        'Content-Type': declared || 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
      })
      const length = upstream.headers.get('content-length')
      if (length) headers.set('Content-Length', length)
      return new Response(upstream.body, { status: 200, headers })
    }

    // Bare originals often return application/octet-stream (or empty type).
    // Buffer the body and accept only when magic bytes match a known image.
    const buffer = await upstream.arrayBuffer()
    const sniffed = sniffImageContentType(buffer)
    if (!sniffed) {
      return jsonError(502, 'upstream_failed', '图片地址返回的不是图片内容')
    }

    const headers = new Headers({
      'Content-Type': sniffed,
      'Cache-Control': 'public, max-age=300',
      'Content-Length': String(buffer.byteLength),
    })
    return new Response(buffer, { status: 200, headers })
  } catch (reason) {
    const message =
      reason instanceof Error && reason.message.startsWith('REDIRECT_')
        ? '图片重定向到了不受支持的域名'
        : '图片代理请求失败，请检查网络后重试'
    return jsonError(502, 'upstream_failed', message)
  }
}
