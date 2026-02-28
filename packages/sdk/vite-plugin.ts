import { join, dirname } from 'path';
import { cpSync, existsSync, mkdirSync, watch, type FSWatcher } from 'fs';
import type { Plugin, ViteDevServer } from 'vite';

export interface CopySDKFilesOptions {
  verbose?: boolean;
  publicDir?: string;
  directories?: string[];
}

const DEFAULT_DIRECTORIES = ['workers', 'raptorQ', 'polyfills', 'opus_decoder'];
const SDK_ROOT_FILES = ['sdk-sw.js'];

export function copySDKStaticFiles(options: CopySDKFilesOptions = {}): Plugin {
  const {
    verbose = false,
    publicDir: customPublicDir = 'public',
    directories = DEFAULT_DIRECTORIES,
  } = options;

  let sdkPath: string | null = null;
  let isMonorepo = false;
  let watchers: FSWatcher[] = [];
  let server: ViteDevServer | null = null;

  const log = (message: string) => {
    if (verbose) console.log(`[ermis-sdk] ${message}`);
  };

  const findSdkPath = (projectRoot: string): string | null => {
    const nodeModulesPath = join(projectRoot, 'node_modules/@ermisnetwork/ermis-classroom-sdk/src');
    if (existsSync(nodeModulesPath)) {
      isMonorepo = false;
      return nodeModulesPath;
    }
    const monorepoPatterns = [
      join(projectRoot, '../packages/sdk/src'),
      join(projectRoot, '../../packages/sdk/src'),
      join(projectRoot, '../../../packages/sdk/src'),
    ];
    for (const pattern of monorepoPatterns) {
      if (existsSync(pattern)) {
        isMonorepo = true;
        return pattern;
      }
    }
    return null;
  };

  const copyDirectory = (src: string, dest: string, dirName: string): boolean => {
    if (!existsSync(src)) return false;
    const parentDir = dirname(dest);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    log(`Copied ${dirName}/`);
    return true;
  };

  const copyAllDirectories = (projectRoot: string) => {
    if (!sdkPath) sdkPath = findSdkPath(projectRoot);
    if (!sdkPath) {
      console.warn('[ermis-sdk] SDK not found in node_modules or local workspace.');
      return;
    }
    const publicDir = join(projectRoot, customPublicDir);
    log('Copying static files from SDK...');
    let copied = 0;
    for (const dir of directories) {
      const src = join(sdkPath, dir);
      const dest = join(publicDir, dir);
      if (copyDirectory(src, dest, dir)) copied++;
    }
    // Copy root-level SDK files (e.g. sdk-sw.js)
    for (const file of SDK_ROOT_FILES) {
      const src = join(sdkPath, file);
      if (existsSync(src)) {
        const dest = join(publicDir, file);
        cpSync(src, dest, { force: true });
        log(`Copied ${file}`);
      }
    }
    const source = isMonorepo ? 'local monorepo' : 'node_modules';
    log(`Copied ${copied}/${directories.length} directories from ${source}`);
  };

  const setupWatchers = (projectRoot: string) => {
    if (!sdkPath || !isMonorepo) return;
    watchers.forEach(w => w.close());
    watchers = [];
    const publicDir = join(projectRoot, customPublicDir);
    for (const dir of directories) {
      const srcDir = join(sdkPath, dir);
      if (!existsSync(srcDir)) continue;
      try {
        const watcher = watch(srcDir, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;
          log(`${dir}/${filename} changed, re-copying...`);
          const src = join(sdkPath!, dir);
          const dest = join(publicDir, dir);
          copyDirectory(src, dest, dir);
          if (server) server.ws.send({ type: 'full-reload' });
        });
        watchers.push(watcher);
        log(`Watching ${dir}/ for changes`);
      } catch (err) {
        console.warn(`[ermis-sdk] Failed to watch ${dir}:`, err);
      }
    }
  };

  return {
    name: 'ermis-sdk-static-files',
    enforce: 'pre',
    configResolved(config) {
      sdkPath = findSdkPath(config.root);
    },
    buildStart() {
      copyAllDirectories(process.cwd());
    },
    configureServer(devServer) {
      server = devServer;
      const projectRoot = devServer.config.root;
      copyAllDirectories(projectRoot);
      if (isMonorepo) {
        setupWatchers(projectRoot);
        log('Hot reload enabled for SDK static files');
      }
    },
    closeBundle() {
      watchers.forEach(w => w.close());
      watchers = [];
    },
  };
}

