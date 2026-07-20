import { isAllowedImageTarget, normalizeImageUrl } from './allowlist'
import { fetchWithAllowedRedirects } from './redirect'
import { UA, XHS_REFERER, type XhsErrorBody } from './types'

function jsonError(status: number, error: XhsErrorBody['error'], message: string): Response {
  const body: XhsErrorBody = { error, message }
  return Response.json(body, { status })
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

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    if (!contentType.toLowerCase().startsWith('image/')) {
      return jsonError(502, 'upstream_failed', '图片地址返回的不是图片内容')
    }

    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    })
    const length = upstream.headers.get('content-length')
    if (length) headers.set('Content-Length', length)

    return new Response(upstream.body, { status: 200, headers })
  } catch (reason) {
    const message =
      reason instanceof Error && reason.message.startsWith('REDIRECT_')
        ? '图片重定向到了不受支持的域名'
        : '图片代理请求失败，请检查网络后重试'
    return jsonError(502, 'upstream_failed', message)
  }
}
