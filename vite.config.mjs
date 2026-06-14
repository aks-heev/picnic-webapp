// vite.config.mjs
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Multi-page build: public site + separate admin entry.
      // Emits dist/index.html and dist/admin.html.
      input: {
        main: resolve(here, 'index.html'),
        admin: resolve(here, 'admin.html'),
        privacy: resolve(here, 'privacy.html'),
        terms: resolve(here, 'terms.html'),
        cancellation: resolve(here, 'cancellation.html'),
        disclaimer: resolve(here, 'disclaimer.html'),
      },
    },
  },
  // VITE_ prefixed vars in .env.local are automatically available
  // in client code via import.meta.env — no manual define block needed.
})
