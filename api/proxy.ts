import { proxyRequest } from '../worker/main.js'

export default {
  fetch(request: Request, env?: { ASSETS?: { fetch(request: Request): Promise<Response> } }) {
    if (new URL(request.url).pathname !== '/api/proxy') {
      return env?.ASSETS?.fetch(request) ?? new Response('Not found', { status: 404 })
    }
    return proxyRequest(request)
  },
}
