import { proxyRequest, type ProxyEnvironment } from '../../server/proxy.ts'

export function onRequest({ request, env }: { request: Request; env: ProxyEnvironment }) {
  return proxyRequest(request, env)
}
