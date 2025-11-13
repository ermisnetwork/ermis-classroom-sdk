import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyPatchFiles } from "@ermisnetwork/ermis-classroom-patch-files/plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copyPatchFiles({
      verbose: true,
    }),
  ],
  server: {
    open: true,
    // host: true,
    port: 3000,
    allowedHosts: ["meet.xoithit.lol", "admin.bandia.vn", "4000.bandia.vn", "xoithit.lol"],
  },
  // Configure base URL for production deployment
  base: "/",
  // Build configuration
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      onwarn(warning, warn) {
        // Ignore warnings about unresolved dynamic imports from public folder
        if (
          warning.code === 'UNRESOLVED_IMPORT' &&
          (warning.exporter?.includes('/raptorQ/') ||
            warning.exporter?.includes('/opus_decoder/'))
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
