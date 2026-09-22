import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { apiProxy } from './scripts/vite-proxy.ts'

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss(), apiProxy(loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'PROXY_'))],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
}))
