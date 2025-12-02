import {join} from 'path';
import {cpSync, existsSync} from 'fs';
import type {Plugin} from 'vite';

export interface CopySDKFilesOptions {
  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;
}

/**
 * Vite plugin to copy static files from SDK to public directory
 * Works in both monorepo and npm package scenarios
 *
 * @example
 * ```typescript
 * import { copySDKStaticFiles } from '@ermisnetwork/ermis-classroom-sdk/vite-plugin';
 *
 * export default defineConfig({
 *   plugins: [
 *     react(),
 *     copySDKStaticFiles({ verbose: true }),
 *   ],
 * });
 * ```
 */
export function copySDKStaticFiles(options: CopySDKFilesOptions = {}): Plugin {
  const {verbose = false} = options;

  const log = (message: string) => {
    if (verbose) {
      console.log(`[copy-sdk-files] ${message}`);
    }
  };

  return {
    name: 'copy-sdk-static-files',

    buildStart() {
      // Try to copy from node_modules first (for published SDK), fallback to local src
      let sdkPath = join(process.cwd(), 'node_modules/@ermisnetwork/ermis-classroom-sdk/src');

      // If not in node_modules, we're in monorepo - use local src
      if (!existsSync(sdkPath)) {
        sdkPath = join(process.cwd(), '../../packages/sdk/src');
      }

      const publicDir = join(process.cwd(), 'public');

      if (!existsSync(sdkPath)) {
        console.warn('[copy-sdk-files] SDK not found in node_modules or local workspace.');
        return;
      }

      const staticDirs = ['workers', 'raptorQ', 'polyfills', 'opus_decoder'];

      log('�� Copying static files from SDK...');

      let copied = 0;

      for (const dir of staticDirs) {
        const src = join(sdkPath, dir);
        const dest = join(publicDir, dir);

        if (existsSync(src)) {
          cpSync(src, dest, {recursive: true, force: true});
          log(`  ✅ Copied ${dir}/`);
          copied++;
        }
      }

      const source = sdkPath.includes('node_modules') ? 'node_modules' : 'local src';
      log(`✨ Copied ${copied}/${staticDirs.length} directories from ${source}`);
    },

    configureServer(server) {
      // Watch SDK src for changes in monorepo development
      const localSdkSrc = join(process.cwd(), '../../packages/sdk/src');

      if (existsSync(localSdkSrc)) {
        server.watcher.add(localSdkSrc);

        server.watcher.on('change', (path: string) => {
          if (path.startsWith(localSdkSrc)) {
            log('SDK src changed, re-copying...');
            // Manually trigger copy again
            const publicDir = join(process.cwd(), 'public');
            const staticDirs = ['workers', 'raptorQ', 'polyfills', 'opus_decoder'];

            for (const dir of staticDirs) {
              const src = join(localSdkSrc, dir);
              const dest = join(publicDir, dir);
              if (existsSync(src)) {
                cpSync(src, dest, {recursive: true, force: true});
              }
            }
          }
        });
      }
    }
  };
}
