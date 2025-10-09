const fs = require('fs');
const path = require('path');

const rootPackage = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const distPackage = {
  name: '@ermisnetwork/ermis-classroom-sdk',
  version: rootPackage.version,
  description: rootPackage.description,
  main: 'ermis-classroom.cjs.js',
  module: 'ermis-classroom.esm.js',
  browser: 'ermis-classroom.js',
  types: 'types/index.d.ts',
  files: [
    '*.js',
    '*.js.map',
    'opus_decoder/',
    'polyfills/',
    'raptorQ/',
    'workers/',
    'types/',
    'package.json',
    'README.md',
    'LICENSE'
  ],
  keywords: rootPackage.keywords,
  author: rootPackage.author,
  license: rootPackage.license,
  repository: rootPackage.repository,
  bugs: rootPackage.bugs,
  homepage: rootPackage.homepage,
  publishConfig: {
    registry: 'https://npm.pkg.github.com',
    access: 'public'
  },
  dependencies: rootPackage.dependencies || {},
  peerDependencies: rootPackage.peerDependencies || {},
  peerDependenciesMeta: rootPackage.peerDependenciesMeta || {},
  browserslist: rootPackage.browserslist,
  engines: rootPackage.engines,
  exports: {
    '.': {
      types: './types/index.d.ts',
      import: './ermis-classroom.esm.js',
      require: './ermis-classroom.cjs.js',
      browser: './ermis-classroom.js',
      default: './ermis-classroom.esm.js'
    },
    './opus_decoder/*': './opus_decoder/*',
    './polyfills/*': './polyfills/*',
    './raptorQ/*': './raptorQ/*',
    './workers/*': './workers/*',
    './package.json': './package.json'
  },
  sideEffects: false
};

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify(distPackage, null, 2) + '\n'
);

console.log('✓ Created dist/package.json');

