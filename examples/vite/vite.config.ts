import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // host: true,
    port: 3001,
    allowedHosts: ['tuanmua.bandia.vn'],
  },
  // Configure base URL for production deployment
  base: '/',
  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
})
