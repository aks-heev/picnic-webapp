// vite.config.mjs
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
  },
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY),
  },
})
