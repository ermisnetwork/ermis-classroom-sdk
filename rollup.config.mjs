import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import terser from "@rollup/plugin-terser";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import copy from "rollup-plugin-copy";
import { readFileSync } from "fs";

// Read package.json for version and metadata
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Banner for built files
const banner = `/**
 * ${pkg.name} v${pkg.version}
 * ${pkg.description}
 * 
 * @author ${pkg.author.name} <${pkg.author.email}>
 * @license ${pkg.license}
 * @homepage ${pkg.homepage}
 */`;

// Base configuration
const baseConfig = {
  input: "src/index.js",
  external: [], // No external dependencies since we want a standalone bundle

  // Disable code splitting for UMD builds
  manualChunks: undefined,

  plugins: [
    // Copy static files
    copy({
      targets: [
        { src: "src/opus_decoder/**/*", dest: "dist/opus_decoder" },
        { src: "src/raptorQ/**/*", dest: "dist/raptorQ" },
        { src: "src/polyfills/**/*", dest: "dist/polyfills" },
        { src: "src/workers/**/*", dest: "dist/workers" },
        { src: "types/index.d.ts", dest: "dist/types" },
        { src: "README.md", dest: "dist/" },
        { src: "LICENSE", dest: "dist/" },
      ],
      hook: 'writeBundle',
    }),

    // Replace environment variables
    replace({
      preventAssignment: true,
      values: {
        __VERSION__: JSON.stringify(pkg.version),
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
    }),

    // Resolve node modules
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ["browser", "import", "module", "default"],
    }),

    // Handle CommonJS modules
    commonjs({
      include: /node_modules/,
    }),

    // Handle JSON imports
    json(),

    // Babel transpilation
    babel({
      babelHelpers: "bundled",
      exclude: /node_modules/,
      presets: [
        [
          "@babel/preset-env",
          {
            targets: {
              browsers: ["defaults", "not IE 11", "not op_mini all"],
            },
            modules: false,
            useBuiltIns: "usage",
            corejs: 3,
          },
        ],
      ],
    }),
  ],
};

// Multiple build configurations for different module formats
const buildConfigs = [
  // ES Module build - single file to match package.json
  {
    ...baseConfig,
    output: {
      file: "dist/ermis-classroom.esm.js",
      format: "es",
      banner,
      sourcemap: true,
      inlineDynamicImports: true,
    },
  },

  // UMD build - single file
  {
    ...baseConfig,
    output: {
      file: "dist/ermis-classroom.js",
      format: "umd",
      name: "ErmisClassroom",
      banner,
      sourcemap: true,
      globals: {},
      exports: "named",
      inlineDynamicImports: true,
    },
  },

  // UMD minified build - single file
  {
    ...baseConfig,
    output: {
      file: "dist/ermis-classroom.min.js",
      format: "umd",
      name: "ErmisClassroom",
      banner,
      sourcemap: true,
      globals: {},
      inlineDynamicImports: true,
    },
    plugins: [
      ...baseConfig.plugins,
      terser({
        compress: {
          drop_console: true,
        },
        mangle: true,
      }),
    ],
  },

  // CommonJS build - single file
  {
    ...baseConfig,
    output: {
      file: "dist/ermis-classroom.cjs.js",
      format: "cjs",
      banner,
      sourcemap: true,
      exports: "auto",
      inlineDynamicImports: true,
    },
  },
];

// Export configuration
export default buildConfigs;
