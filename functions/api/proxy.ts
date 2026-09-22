import { proxyRequest } from '../../server/proxy.ts'

export function onRequest({ request }: { request: Request }) {
  return proxyRequest(request)
}
