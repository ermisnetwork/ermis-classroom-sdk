#!/usr/bin/env node

/**
 * Copy static files (workers, WASM, polyfills) to dist/
 * This ensures SDK users have all necessary runtime files
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, '..');
const SRC_DIR = join(ROOT_DIR, 'src');
const DIST_DIR = join(ROOT_DIR, 'dist');

// Directories to copy
const STATIC_DIRS = ['workers', 'raptorQ', 'polyfills', 'opus_decoder'];

console.log('📦 Copying static files to dist/...\n');

let totalFiles = 0;

STATIC_DIRS.forEach((dir) => {
    const srcPath = join(SRC_DIR, dir);
    const destPath = join(DIST_DIR, dir);

    if (!existsSync(srcPath)) {
        console.log(`⚠️  Skipping ${dir}/ (not found in src/)`);
        return;
    }

    try {
        // Create destination directory if it doesn't exist
        mkdirSync(destPath, { recursive: true });

        // Copy recursively with filter
        cpSync(srcPath, destPath, {
            recursive: true,
            force: true,
            filter: (src) => {
                // Copy all files including .d.ts, .wasm, .js, etc.
                return true;
            }
        });

        // Count files (simple approximation)
        const files = countFilesInDir(srcPath);
        totalFiles += files;

        console.log(`✅ Copied ${dir}/ (${files} files)`);
    } catch (error) {
        console.error(`❌ Error copying ${dir}/:`, error.message);
        process.exit(1);
    }
});

console.log(`\n✨ Successfully copied ${totalFiles} static files to dist/\n`);

// Extra step: Explicitly copy .d.ts files that might have been missed
console.log('📝 Ensuring .d.ts files are copied...\n');

STATIC_DIRS.forEach((dir) => {
    const srcPath = join(SRC_DIR, dir);
    const destPath = join(DIST_DIR, dir);

    if (!existsSync(srcPath)) {
        return;
    }

    try {
        // Find all .d.ts files in the source directory
        const entries = readdirSync(srcPath);
        const dtsFiles = entries.filter(file => file.endsWith('.d.ts'));

        if (dtsFiles.length > 0) {
            dtsFiles.forEach(file => {
                const srcFile = join(srcPath, file);
                const destFile = join(destPath, file);
                copyFileSync(srcFile, destFile);
                console.log(`  ✅ Copied ${dir}/${file}`);
            });
        }
    } catch (error) {
        console.error(`❌ Error copying .d.ts files from ${dir}/:`, error.message);
    }
});

console.log('\n✨ All static files copied successfully!\n');

/**
 * Recursively count files in a directory
 */
function countFilesInDir(dirPath) {
    let count = 0;

    try {
        const entries = readdirSync(dirPath);

        for (const entry of entries) {
            const fullPath = join(dirPath, entry);
            const stats = statSync(fullPath);

            if (stats.isDirectory()) {
                count += countFilesInDir(fullPath);
            } else {
                count++;
            }
        }
    } catch (error) {
        // Ignore errors for inaccessible directories
    }

    return count;
}
