import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { apiProxy } from './scripts/vite-proxy.ts'
import telemetry from './telemetry.json' with { type: 'json' }

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    apiProxy(),
    {
      name: 'telemetry',
      apply: 'build',
      transformIndexHtml: () => telemetry.scripts.map(script => ({
        tag: 'script',
        attrs: {
          defer: true,
          src: `${telemetry.origin}/${script}`,
          'data-website-id': telemetry.websiteId,
        },
        injectTo: 'head' as const,
      })),
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
