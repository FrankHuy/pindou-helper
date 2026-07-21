import { isAllowedShareTarget, normalizeImageUrl, parseShareUrl } from './allowlist'
import {
  findNote,
  highestImageUrl,
  jpgUrlFromFileId,
  resolveImageSourceUrl,
  resolveToken,
  stateFromPage,
} from './parse'
import { fetchWithAllowedRedirects } from './redirect'
import { verifyTurnstileToken } from './turnstile'
import type { XhsErrorBody, XhsImageItem, XhsParseSuccess } from './types'
import { UA } from './types'

export type ParseEnv = {
  TURNSTILE_SECRET?: string
}

function jsonError(status: number, error: XhsErrorBody['error'], message: string): Response {
  const body: XhsErrorBody = { error, message }
  return Response.json(body, { status })
}

/** First http(s) URL in free-form share text (client also extracts; belt-and-suspenders). */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  // Share cards often append Chinese copy immediately after the URL.
  const withoutCjk = match[0].split(/[一-鿿]/u, 1)[0] ?? match[0]
  return withoutCjk.replace(/[),.;!?，。；！？]+$/u, '')
}

function buildProxyPath(imageUrl: string): string {
  return `/api/xhs/image?u=${encodeURIComponent(imageUrl)}`
}

function normalizeHttpsCandidate(raw: string): URL | null {
  const sourceUrl = raw.replace(/^http:\/\//i, 'https://')
  return normalizeImageUrl(sourceUrl)
}

/** POST /api/xhs/parse — fetch share page, parse INITIAL_STATE, return proxy paths. */
export async function parseNote(request: Request, env: ParseEnv = {}): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'invalid_url', '请求体必须是 JSON，包含 url 字段')
  }

  const bodyRecord =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null

  const rawInput = bodyRecord && 'url' in bodyRecord ? String(bodyRecord.url ?? '') : ''

  if (!rawInput.trim()) {
    return jsonError(400, 'invalid_url', '请粘贴小红书分享链接')
  }

  // Anti-abuse: only when secret is configured (production). Local/dev without secret bypasses.
  const secret = env.TURNSTILE_SECRET?.trim()
  if (secret) {
    const token =
      bodyRecord && 'turnstileToken' in bodyRecord
        ? String(bodyRecord.turnstileToken ?? '')
        : ''
    const remoteip =
      request.headers.get('CF-Connecting-IP') ??
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
      undefined
    const verified = await verifyTurnstileToken(secret, token, remoteip)
    if (!verified.ok) {
      const message =
        verified.reason === 'missing_token'
          ? '请完成人机验证后再解析'
          : '人机验证失败，请刷新验证后重试'
      return jsonError(403, 'turnstile_failed', message)
    }
  }

  const extracted = extractFirstUrl(rawInput) ?? rawInput.trim()
  const shareUrl = parseShareUrl(extracted)
  if (!shareUrl) {
    return jsonError(
      400,
      'invalid_url',
      '链接无效或不在允许域名内（仅支持 xiaohongshu.com / xhslink.com）',
    )
  }

  let pageResponse: Response
  try {
    pageResponse = await fetchWithAllowedRedirects(
      shareUrl,
      {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      isAllowedShareTarget,
    )
  } catch (reason) {
    const message =
      reason instanceof Error && reason.message.startsWith('REDIRECT_')
        ? '分享链接重定向后的域名不受支持'
        : '无法访问小红书页面，请检查网络后重试'
    return jsonError(502, 'upstream_failed', message)
  }

  if (!pageResponse.ok) {
    if (pageResponse.status === 404) {
      return jsonError(404, 'parse_failed', '帖子不存在或已删除')
    }
    return jsonError(
      502,
      'upstream_failed',
      `获取分享页失败（${pageResponse.status}），请稍后重试`,
    )
  }

  const resolvedUrl = pageResponse.url || shareUrl.toString()
  try {
    if (!isAllowedShareTarget(new URL(resolvedUrl))) {
      return jsonError(400, 'invalid_url', '重定向后的域名不受支持')
    }
  } catch {
    return jsonError(400, 'invalid_url', '解析重定向地址失败')
  }

  const html = await pageResponse.text()

  let state: unknown
  try {
    state = stateFromPage(html)
  } catch {
    // Missing INITIAL_STATE is often a login wall or unavailable post.
    return jsonError(
      403,
      'login_required',
      '无法解析页面（帖子可能需登录、不存在或仅限 App 内查看）',
    )
  }

  let note
  try {
    note = findNote(state)
  } catch {
    return jsonError(
      422,
      'not_image_note',
      '未找到图文内容（可能是视频帖、空帖或页面结构已变更）',
    )
  }

  const images: XhsImageItem[] = []
  for (let i = 0; i < note.imageList.length; i++) {
    const image = note.imageList[i]
    const token = resolveToken(image)

    // Prefer bare original from token; if that URL fails allowlist normalize,
    // try public-page derivative. Skip only when both fail.
    const candidates: string[] = []
    try {
      candidates.push(resolveImageSourceUrl(image))
    } catch {
      // no usable source from token or infoList
    }
    // When token won, still queue public-page URL so normalize failure can recover.
    if (token) {
      try {
        candidates.push(highestImageUrl(image))
      } catch {
        // no public-page derivative either
      }
    }

    let normalized: URL | null = null
    for (const raw of candidates) {
      normalized = normalizeHttpsCandidate(raw)
      if (normalized) break
    }
    if (!normalized) continue

    const item: XhsImageItem = {
      index: i + 1,
      width: typeof image.width === 'number' ? image.width : 0,
      height: typeof image.height === 'number' ? image.height : 0,
      proxyPath: buildProxyPath(normalized.toString()),
    }

    // Optional CDN JPG of the same token (not WB_DFT webpic).
    if (token) {
      try {
        const jpgNormalized = normalizeHttpsCandidate(jpgUrlFromFileId(token))
        if (jpgNormalized) {
          item.proxyPathJpg = buildProxyPath(jpgNormalized.toString())
        }
      } catch {
        // omit proxyPathJpg on builder failure
      }
    }

    images.push(item)
  }

  if (images.length === 0) {
    return jsonError(422, 'not_image_note', '帖子中没有可下载的图片')
  }

  const title =
    typeof note.title === 'string' && note.title.trim() ? note.title.trim() : '未命名笔记'

  const result: XhsParseSuccess = {
    title,
    resolvedUrl,
    images,
  }
  return Response.json(result)
}
