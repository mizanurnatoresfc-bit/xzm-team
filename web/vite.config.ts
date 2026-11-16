import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Every build gets an id; the app compares its own id with /version.json to offer "আপডেট করুন".
const BUILD_ID = (process.env.GITHUB_SHA ?? '').slice(0, 10) || `local-${Date.now().toString(36)}`
const versionFile = (): Plugin => ({
  name: 'xzm-version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID, at: new Date().toISOString() }) })
  },
})

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: '0.0.0.0' },
  build: {
    // Libraries change rarely: keep them in their own files so phones keep them cached between updates.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
