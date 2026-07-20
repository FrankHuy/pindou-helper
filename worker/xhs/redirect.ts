/** Validate and follow redirects only within an allowlisted host set. */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type AllowedTarget = (url: URL) => boolean

function isRedirectResponse(response: Response): boolean {
  return REDIRECT_STATUSES.has(response.status)
}

/**
 * Fetch with redirect validation so every hop stays on an allowlisted host.
 *
 * This prevents open-redirect SSRF from allowlisted share/CDN domains.
 */
export async function fetchWithAllowedRedirects(
  input: string | URL,
  init: RequestInit,
  isAllowedTarget: AllowedTarget,
  maxRedirects = 5,
): Promise<Response> {
  let current = new URL(input.toString())

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current.toString(), {
      ...init,
      redirect: 'manual',
    })

    if (!isRedirectResponse(response)) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      return response
    }

    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      throw new Error('REDIRECT_INVALID')
    }

    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new Error('REDIRECT_INVALID')
    }
    if (!isAllowedTarget(next)) {
      throw new Error('REDIRECT_BLOCKED')
    }

    current = next
  }

  throw new Error('REDIRECT_TOO_MANY')
}
