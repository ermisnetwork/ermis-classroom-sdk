import { join, dirname } from 'path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';

export interface CopyPatchFilesOptions {
  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;
}

/**
 * Vite plugin to copy patch files from the package to the public directory
 */
export function copyPatchFiles(options: CopyPatchFilesOptions = {}): any {
  const { verbose = false } = options;
  let viteConfig: any;
  let sourceDir: string;
  let destDir: string;

  const log = (message: string) => {
    if (verbose) {
      console.log(`[copy-patch-files] ${message}`);
    }
  };

  const copyRecursive = (src: string, dest: string) => {
    const stats = statSync(src);

    if (stats.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      const entries = readdirSync(src);

      for (const entry of entries) {
        copyRecursive(join(src, entry), join(dest, entry));
      }
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      log(`  ✓ Copied: ${dest.replace(destDir + '/', '')}`);
    }
  };

  const copyFiles = () => {
    const startTime = Date.now();
    log('Copying patch files...');

    try {
      copyRecursive(sourceDir, destDir);
      const duration = Date.now() - startTime;

      const fileCount = countFiles(destDir);
      log(`✓ Copied ${fileCount} files in ${duration}ms`);
    } catch (error) {
      console.error('[copy-patch-files] Error copying files:', error);
      throw error;
    }
  };

  const countFiles = (dir: string): number => {
    let count = 0;
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        count += countFiles(fullPath);
      } else {
        count++;
      }
    }

    return count;
  };

  return {
    name: 'copy-patch-files',

    configResolved(config: any) {
      viteConfig = config;

      // Find the package in node_modules
      const packageName = '@ermisnetwork/ermis-classroom-patch-files';
      const packagePath = join(viteConfig.root, 'node_modules', packageName);

      // Source is the 'files' directory in the package
      sourceDir = join(packagePath, 'files');

      // Destination is the public directory of the Vite project
      destDir = join(viteConfig.root, 'public');

      if (verbose) {
        console.log('[copy-patch-files] Configuration:');
        console.log(`  Source: ${sourceDir}`);
        console.log(`  Destination: ${destDir}`);
      }
    },

    buildStart() {
      copyFiles();
    },

    configureServer(server: any) {
      // Copy files when dev server starts
      copyFiles();

      // Watch for changes in source directory and copy on change
      server.watcher.add(sourceDir);
      server.watcher.on('change', (path: string) => {
        if (path.startsWith(sourceDir)) {
          log('Source files changed, re-copying...');
          copyFiles();
        }
      });
    },
  };
}

