import type {Plugin} from 'vite';

export interface CopySDKFilesOptions {
  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;
  /**
   * Custom public directory path (relative to project root)
   * @default 'public'
   */
  publicDir?: string;
  /**
   * Directories to copy from SDK
   * @default ['workers', 'raptorQ', 'polyfills', 'opus_decoder']
   */
  directories?: string[];
}

export function copySDKStaticFiles(options?: CopySDKFilesOptions): Plugin;

