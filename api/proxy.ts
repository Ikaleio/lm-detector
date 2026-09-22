import { proxyRequest } from '../server/proxy.ts'

export default {
  fetch(request: Request) {
    return proxyRequest(request, { PROXY_ALLOWED_HOSTS: process.env.PROXY_ALLOWED_HOSTS })
  },
}
