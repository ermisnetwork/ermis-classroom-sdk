import { join } from 'path';
import { cpSync, existsSync } from 'fs';

/**
 * Vite plugin to copy static files from SDK dist to public directory
 * This avoids duplicating files across the monorepo
 * 
 * @example
 * ```typescript
 * import { copySDKStaticFiles } from '../../../shared/vite-plugin-sdk-files';
 * 
 * export default defineConfig({
 *   plugins: [
 *     react(),
 *     copySDKStaticFiles({ verbose: true }),
 *   ],
 * });
 * ```
 */
export function copySDKStaticFiles(options: { verbose?: boolean } = {}) {
    const { verbose = false } = options;

    return {
        name: 'copy-sdk-static-files',

        buildStart() {
            // Assuming we're in examples/*/
            const sdkDist = join(process.cwd(), '../../packages/sdk/dist');
            const publicDir = join(process.cwd(), 'public');

            if (!existsSync(sdkDist)) {
                console.warn('[copy-sdk-files] SDK dist not found. Run `pnpm build` in packages/sdk first.');
                return;
            }

            const staticDirs = ['workers', 'raptorQ', 'polyfills', 'opus_decoder', 'constants'];

            if (verbose) {
                console.log('📦 Copying static files from SDK...');
            }

            let copied = 0;

            for (const dir of staticDirs) {
                const src = join(sdkDist, dir);
                const dest = join(publicDir, dir);

                if (existsSync(src)) {
                    cpSync(src, dest, { recursive: true, force: true });
                    if (verbose) {
                        console.log(`  ✅ Copied ${dir}/`);
                    }
                    copied++;
                }
            }

            if (verbose) {
                console.log(`✨ Copied ${copied}/${staticDirs.length} directories`);
            }
        },

        configureServer(server: any) {
            // Also copy when dev server starts
            const sdkDist = join(process.cwd(), '../../packages/sdk/dist');

            if (existsSync(sdkDist)) {
                // Watch SDK dist for changes
                server.watcher.add(sdkDist);

                server.watcher.on('change', (path: string) => {
                    if (path.startsWith(sdkDist)) {
                        if (verbose) {
                            console.log('[copy-sdk-files] SDK changed, re-copying...');
                        }
                        // Re-trigger buildStart
                        this.buildStart?.();
                    }
                });
            }
        }
    };
}
