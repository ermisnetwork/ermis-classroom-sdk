import type { Plugin } from 'vite';

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
 */
export declare function copySDKStaticFiles(options?: CopySDKFilesOptions): Plugin;
