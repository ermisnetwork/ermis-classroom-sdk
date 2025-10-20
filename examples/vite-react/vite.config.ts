import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyPatchFiles } from '@ermisnetwork/ermis-classroom-patch-files/plugin'

export default defineConfig({
  plugins: [
    react(),
    copyPatchFiles({
      verbose: true,
    }),
  ],
  server: {
    port: 3001,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
})
