import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { copySDKStaticFiles } from '@ermisnetwork/ermis-classroom-sdk/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    copySDKStaticFiles({verbose: true})
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 4000,
    allowedHosts: ['4000.bandia.vn']
  },
})

