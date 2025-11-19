// vite-plugin.ts
import { join } from "path";
import { cpSync, existsSync } from "fs";
function copySDKStaticFiles(options = {}) {
  const { verbose = false } = options;
  const log = (message) => {
    if (verbose) {
      console.log(`[copy-sdk-files] ${message}`);
    }
  };
  return {
    name: "copy-sdk-static-files",
    buildStart() {
      let sdkPath = join(process.cwd(), "node_modules/@ermisnetwork/ermis-classroom-sdk/src");
      if (!existsSync(sdkPath)) {
        sdkPath = join(process.cwd(), "../../packages/sdk/src");
      }
      const publicDir = join(process.cwd(), "public");
      if (!existsSync(sdkPath)) {
        console.warn("[copy-sdk-files] SDK not found in node_modules or local workspace.");
        return;
      }
      const staticDirs = ["workers", "raptorQ", "polyfills", "opus_decoder"];
      log("\uFFFD\uFFFD Copying static files from SDK...");
      let copied = 0;
      for (const dir of staticDirs) {
        const src = join(sdkPath, dir);
        const dest = join(publicDir, dir);
        if (existsSync(src)) {
          cpSync(src, dest, { recursive: true, force: true });
          log(`  \u2705 Copied ${dir}/`);
          copied++;
        }
      }
      const source = sdkPath.includes("node_modules") ? "node_modules" : "local src";
      log(`\u2728 Copied ${copied}/${staticDirs.length} directories from ${source}`);
    },
    configureServer(server) {
      const localSdkSrc = join(process.cwd(), "../../packages/sdk/src");
      if (existsSync(localSdkSrc)) {
        server.watcher.add(localSdkSrc);
        server.watcher.on("change", (path) => {
          if (path.startsWith(localSdkSrc)) {
            log("SDK src changed, re-copying...");
            const publicDir = join(process.cwd(), "public");
            const staticDirs = ["workers", "raptorQ", "polyfills", "opus_decoder"];
            for (const dir of staticDirs) {
              const src = join(localSdkSrc, dir);
              const dest = join(publicDir, dir);
              if (existsSync(src)) {
                cpSync(src, dest, { recursive: true, force: true });
              }
            }
          }
        });
      }
    }
  };
}
export {
  copySDKStaticFiles
};
