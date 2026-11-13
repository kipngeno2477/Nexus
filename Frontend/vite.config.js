import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, /api is proxied to the Express backend. In production, Express serves dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:5000', changeOrigin: true },
    },
  },
})
