/** Host allowlists for SSRF protection on parse + image proxy. */

const SHARE_HOSTS = new Set([
  'www.xiaohongshu.com',
  'xiaohongshu.com',
  'xhslink.com',
  'www.xhslink.com',
])

/** True when hostname is a known XHS share / short-link host. */
export function isAllowedShareHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return SHARE_HOSTS.has(host)
}

/**
 * Allow common XHS image CDN patterns only.
 * Observed: *.xhscdn.com, sns-*.xhscdn.com, ci.xiaohongshu.com, etc.
 */
export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) {
    return true
  }
  if (host === 'xhscdn.com' || host.endsWith('.xhscdn.com')) {
    return true
  }
  return false
}

/** Redirect target allowed while resolving a share / short-link page. */
export function isAllowedShareTarget(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return isAllowedShareHost(host) || host.endsWith('.xiaohongshu.com')
}

/** Redirect target allowed while proxying an image. */
export function isAllowedImageTarget(url: URL): boolean {
  return url.protocol === 'https:' && isAllowedImageHost(url.hostname)
}

/** Force https and reject non-allowlisted image hosts. */
export function normalizeImageUrl(raw: string): URL | null {
  try {
    let forced = raw.trim()
    if (!forced) return null
    // Page state sometimes emits protocol-relative CDN URLs.
    if (forced.startsWith('//')) {
      forced = `https:${forced}`
    } else {
      forced = forced.replace(/^http:\/\//i, 'https://')
    }
    const url = new URL(forced)
    if (url.protocol !== 'https:') return null
    if (!isAllowedImageHost(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

/** Validate share URL after optional clipboard extraction. */
export function parseShareUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!isAllowedShareHost(url.hostname)) return null
    return url
  } catch {
    return null
  }
}
