import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copySDKStaticFiles } from '@ermisnetwork/ermis-classroom-sdk/vite-plugin';

export default defineConfig({
  plugins: [react(), copySDKStaticFiles({ verbose: true })],
  server: {
    port: 4000,
    open: true,
    allowedHosts: true,
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
