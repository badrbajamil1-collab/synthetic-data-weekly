import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ viteEnvironment: { name: 'worker' } })],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  environments: {
    worker: { build: { sourcemap: true } },
  },
})