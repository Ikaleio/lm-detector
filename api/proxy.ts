import { proxyRequest } from '../server/proxy.ts'

export default {
  fetch(request: Request) {
    return proxyRequest(request)
  },
}
