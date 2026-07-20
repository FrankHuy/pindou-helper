import { parseNote } from './xhs/handlers'
import { proxyImage } from './xhs/proxy'

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
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
      return parseNote(request)
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
