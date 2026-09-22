import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { Connect, Plugin } from 'vite'
import { proxyRequest, type ProxyEnvironment } from '../../server/proxy.ts'

export function apiProxy(env: ProxyEnvironment): Plugin {
  const middleware: Connect.NextHandleFunction = async (incoming, outgoing, next) => {
    if (incoming.url?.split('?')[0] !== '/api/proxy') return next()
    const controller = new AbortController()
    const abort = () => controller.abort()
    const onClose = () => { if (!outgoing.writableEnded) abort() }
    incoming.once('aborted', abort)
    outgoing.once('close', onClose)
    try {
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const init: RequestInit & { duplex: 'half' } = {
        method: incoming.method, headers, signal: controller.signal, duplex: 'half',
      }
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      }
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, init)
      const response = await proxyRequest(request, env)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.flushHeaders()
      if (response.body) await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), outgoing)
      else outgoing.end()
    } catch {
      abort()
      if (!outgoing.destroyed && !outgoing.headersSent) {
        outgoing.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        outgoing.end(JSON.stringify({ error: { message: 'The local API proxy failed.' } }))
      } else outgoing.destroy()
    } finally {
      incoming.off('aborted', abort)
      outgoing.off('close', onClose)
    }
  }
  return {
    name: 'fingerpoint-api-proxy',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
