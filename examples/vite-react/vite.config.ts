import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyPatchFiles } from '@ermisnetwork/ermis-classroom-patch-files';

export default defineConfig({
  plugins: [react(), copyPatchFiles({ verbose: true })],
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
