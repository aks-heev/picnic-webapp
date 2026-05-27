// vite.config.mjs
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
  },
  // VITE_ prefixed vars in .env.local are automatically available
  // in client code via import.meta.env — no manual define block needed.
})
