import { defineConfig, type Plugin } from 'vite'
import { proxy } from './server/proxy.js'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const apiProxy: Plugin = {
  name: 'fingerpoint-api',
  configureServer(server) {
    server.middlewares.use('/api/complete', (req, res) => { void proxy(req, res) })
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/complete', (req, res) => { void proxy(req, res) })
  },
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  plugins: [apiProxy, react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
