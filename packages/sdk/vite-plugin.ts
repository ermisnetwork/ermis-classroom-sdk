import { join } from 'path';
import { cpSync, existsSync } from 'fs';
import type { Plugin } from 'vite';

export interface CopySDKFilesOptions {
    /**
     * Enable verbose logging
     * @default false
     */
    verbose?: boolean;

    /**
     * Path to SDK package (relative to project root)
     * @default '../../packages/sdk'
     */
    sdkPath?: string;
}

/**
 * Vite plugin to copy static files from SDK dist to public directory
 * This avoids duplicating files in patch-files package
 */
export function copySDKStaticFiles(options: CopySDKFilesOptions = {}): Plugin {
    const { verbose = false, sdkPath = '../../packages/sdk' } = options;
    let projectRoot: string;
    let sourceDir: string;
    let destDir: string;

    const log = (message: string) => {
        if (verbose) {
            console.log(`[copy-sdk-files] ${message}`);
        }
    };

    const copyFiles = () => {
        const staticDirs = ['workers', 'raptorQ', 'polyfills', 'opus_decoder', 'constants'];
        const startTime = Date.now();

        log('Copying static files from SDK...');

        let totalFiles = 0;

        for (const dir of staticDirs) {
            const srcPath = join(sourceDir, dir);
            const destPath = join(destDir, dir);

            if (!existsSync(srcPath)) {
                log(`⚠️  Skipping ${dir}/ (not found in SDK)`);
                continue;
            }

            try {
                cpSync(srcPath, destPath, {
                    recursive: true,
                    force: true,
                });

                log(`✅ Copied ${dir}/`);
                totalFiles++;
            } catch (error) {
                console.error(`[copy-sdk-files] Error copying ${dir}:`, error);
            }
        }

        const duration = Date.now() - startTime;
        log(`✨ Copied ${totalFiles} directories in ${duration}ms`);
    };

    return {
        name: 'copy-sdk-static-files',

        configResolved(config) {
            projectRoot = config.root;

            // Source is SDK dist directory
            sourceDir = join(projectRoot, sdkPath, 'dist');

            // Destination is public directory
            destDir = join(projectRoot, 'public');

            if (verbose) {
                console.log('[copy-sdk-files] Configuration:');
                console.log(`  Source: ${sourceDir}`);
                console.log(`  Destination: ${destDir}`);
            }

            if (!existsSync(sourceDir)) {
                console.warn('[copy-sdk-files] SDK dist not found. Run `pnpm build` in SDK package first.');
            }
        },

        buildStart() {
            if (existsSync(sourceDir)) {
                copyFiles();
            }
        },

        configureServer(server) {
            // Copy files when dev server starts
            if (existsSync(sourceDir)) {
                copyFiles();
            }

            // Watch SDK dist for changes and re-copy
            server.watcher.add(sourceDir);
            server.watcher.on('change', (path: string) => {
                if (path.startsWith(sourceDir)) {
                    log('SDK files changed, re-copying...');
                    copyFiles();
                }
            });
        },
    };
}
