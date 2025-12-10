import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Node.js polyfills for browser
      "util": "util",
      "stream": "stream-browserify",
    },
  },
  define: {
    // Polyfill for Node.js globals needed by some packages
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis',
      },
    },
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    host: true,
    headers: {

    },
    port: 5173,
    allowedHosts: true,
  },
})