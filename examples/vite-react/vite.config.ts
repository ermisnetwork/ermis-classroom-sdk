import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copySDKStaticFiles } from '../../shared/vite-plugin-sdk-files';

export default defineConfig({
  plugins: [react(), copySDKStaticFiles({ verbose: true })],
  server: {
    port: 3001,
    open: true,
    allowedHosts: ['meet.xoithit.lol', 'admin.bandia.vn', '4000.bandia.vn', 'xoithit.lol'],
  },
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      onwarn(warning, warn) {
        // Ignore warnings about unresolved dynamic imports from public folder
        if (
          warning.code === 'UNRESOLVED_IMPORT' &&
          (warning.exporter?.includes('/raptorQ/') || warning.exporter?.includes('/opus_decoder/'))
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
