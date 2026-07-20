import { parseNote } from './xhs/handlers'
import { proxyImage } from './xhs/proxy'

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
  /** Cloudflare Turnstile secret; when unset, parse skips verification (local dev). */
  TURNSTILE_SECRET?: string
  /**
   * Public Turnstile site key for the widget.
   * Prefer Worker runtime binding so Cloudflare Git builds do not depend on Vite
   * receiving VITE_* at compile time. VITE_TURNSTILE_SITE_KEY is accepted as alias.
   */
  TURNSTILE_SITE_KEY?: string
  VITE_TURNSTILE_SITE_KEY?: string
}

function apiNotFound(): Response {
  return Response.json({ error: 'not_found', message: '接口不存在' }, { status: 404 })
}

function methodNotAllowed(): Response {
  return Response.json({ error: 'method_not_allowed', message: '不支持的请求方法' }, { status: 405 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Public client config (no secrets). Used so the Turnstile widget can load
    // even when VITE_* was not baked into the SPA at build time.
    if (url.pathname === '/api/config') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { Allow: 'GET, OPTIONS' },
        })
      }
      if (request.method !== 'GET') return methodNotAllowed()
      const turnstileSiteKey =
        env.TURNSTILE_SITE_KEY?.trim() ||
        env.VITE_TURNSTILE_SITE_KEY?.trim() ||
        ''
      return Response.json(
        {
          turnstileSiteKey: turnstileSiteKey || null,
          turnstileRequired: Boolean(env.TURNSTILE_SECRET?.trim()),
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      )
    }

    if (url.pathname === '/api/xhs/parse') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            Allow: 'POST, OPTIONS',
          },
        })
      }
      if (request.method !== 'POST') return methodNotAllowed()
      return parseNote(request, env)
    }

    if (url.pathname === '/api/xhs/image') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            Allow: 'GET, OPTIONS',
          },
        })
      }
      if (request.method !== 'GET') return methodNotAllowed()
      return proxyImage(request)
    }

    if (url.pathname.startsWith('/api/')) {
      return apiNotFound()
    }

    // SPA / static assets (run_worker_first only routes /api/* here first)
    return env.ASSETS.fetch(request)
  },
}
