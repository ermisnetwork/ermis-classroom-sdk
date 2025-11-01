import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // host: true,
    port: 4000,
    allowedHosts: ["meet.xoithit.lol", "admin.bandia.vn", "4000.bandia.vn"],
  },
  // Configure base URL for production deployment
  base: "/",
  // Build configuration
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
