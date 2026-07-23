import { routeAdmin } from './admin/handlers'
import {
  handleForgot,
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleResendVerify,
  handleReset,
  handleVerify,
  type AuthWorkerEnv,
} from './auth/handlers'
import { handleAiImageEdit } from './ai/imageEdit'
import { handleAiPing } from './guard/handlers'
import { parseNote } from './xhs/handlers'
import { proxyImage } from './xhs/proxy'

export interface Env extends AuthWorkerEnv {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
  /** Cloudflare Turnstile secret; when unset, parse/auth skips verification (local dev). */
  TURNSTILE_SECRET?: string
  /**
   * Public Turnstile site key for the widget.
   * Prefer Worker runtime binding so Cloudflare Git builds do not depend on Vite
   * receiving VITE_* at compile time. VITE_TURNSTILE_SITE_KEY is accepted as alias.
   */
  TURNSTILE_SITE_KEY?: string
  VITE_TURNSTILE_SITE_KEY?: string
  /** D1 binding (required for auth). */
  DB: D1Database
  /** Resend API key; when unset, auth emails log to console (dev). */
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  /** If register/verify email matches, promote to super_admin. */
  BOOTSTRAP_SUPERADMIN_EMAIL?: string
  /**
   * PBKDF2 iterations (default 100000). Free plan 10ms CPU may need lower values;
   * Workers Paid recommended for production auth.
   */
  PASSWORD_PBKDF2_ITERATIONS?: string
  /** Wisart-compatible image edits — Worker runtime only, never VITE_*. */
  AI_IMAGE_API_KEY?: string
  AI_IMAGE_BASE_URL?: string
  AI_IMAGE_MODEL?: string
  AI_IMAGE_SIZE?: string
  AI_IMAGE_PROMPT_TEMPLATE?: string
}

function apiNotFound(): Response {
  return Response.json({ error: 'not_found', message: '接口不存在' }, { status: 404 })
}

function methodNotAllowed(): Response {
  return Response.json({ error: 'method_not_allowed', message: '不支持的请求方法' }, { status: 405 })
}

function options(...methods: string[]): Response {
  return new Response(null, {
    status: 204,
    headers: { Allow: [...methods, 'OPTIONS'].join(', ') },
  })
}

type RouteHandler = (request: Request, env: Env) => Promise<Response>

async function routeAuth(
  request: Request,
  env: Env,
  method: 'GET' | 'POST',
  handler: RouteHandler,
): Promise<Response> {
  if (request.method === 'OPTIONS') return options(method)
  if (request.method !== method) return methodNotAllowed()
  if (!env.DB) {
    return Response.json(
      { error: 'server_error', message: '数据库未配置' },
      { status: 500 },
    )
  }
  return handler(request, env)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Public client config (no secrets). Used so the Turnstile widget can load
    // even when VITE_* was not baked into the SPA at build time.
    if (url.pathname === '/api/config') {
      if (request.method === 'OPTIONS') return options('GET')
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

    // Auth routes
    if (url.pathname === '/api/auth/register') {
      return routeAuth(request, env, 'POST', handleRegister)
    }
    if (url.pathname === '/api/auth/login') {
      return routeAuth(request, env, 'POST', handleLogin)
    }
    if (url.pathname === '/api/auth/logout') {
      return routeAuth(request, env, 'POST', handleLogout)
    }
    if (url.pathname === '/api/auth/verify') {
      return routeAuth(request, env, 'POST', handleVerify)
    }
    if (url.pathname === '/api/auth/resend-verify') {
      return routeAuth(request, env, 'POST', handleResendVerify)
    }
    if (url.pathname === '/api/auth/forgot') {
      return routeAuth(request, env, 'POST', handleForgot)
    }
    if (url.pathname === '/api/auth/reset') {
      return routeAuth(request, env, 'POST', handleReset)
    }
    if (url.pathname === '/api/me') {
      return routeAuth(request, env, 'GET', handleMe)
    }

    // AI routes (guarded). Ping is ops-only stub; image-edit is product path.
    if (url.pathname === '/api/ai/ping') {
      return routeAuth(request, env, 'POST', handleAiPing)
    }
    if (url.pathname === '/api/ai/image-edit') {
      return routeAuth(request, env, 'POST', handleAiImageEdit)
    }

    // Mini admin (role gate inside handlers)
    if (url.pathname.startsWith('/api/admin')) {
      const adminResponse = await routeAdmin(request, env, url.pathname)
      if (adminResponse) return adminResponse
    }

    if (url.pathname === '/api/xhs/parse') {
      if (request.method === 'OPTIONS') return options('POST')
      if (request.method !== 'POST') return methodNotAllowed()
      return parseNote(request, env)
    }

    if (url.pathname === '/api/xhs/image') {
      if (request.method === 'OPTIONS') return options('GET')
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
