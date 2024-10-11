const esbuild = require("esbuild");
const copyStaticFiles = require("esbuild-copy-static-files");

// Build for browser (minified bundle)
esbuild
  .build({
    entryPoints: ["src/browser/index.ts"],
    bundle: true,
    minify: true,
    outfile: "dist/public/bundle.js",
    sourcemap: true,
    format: "iife",
    globalName: "MicroserviceFramework",
    target: ["es2020"],
    platform: "browser",
    tsconfig: "tsconfig.json",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [
      copyStaticFiles({
        src: "./src/public",
        dest: "./dist/public",
      }),
    ],
  })
  .catch(() => process.exit(1));

// Build for Node.js (CommonJS)
esbuild
  .build({
    entryPoints: ["src/index.ts"],
    outdir: "dist/node",
    format: "cjs",
    target: ["node14"],
    platform: "node",
    tsconfig: "tsconfig.json",
    bundle: false,
    minify: false,
    sourcemap: true,
  })
  .catch(() => process.exit(1));

// Build for browser (ES modules, not bundled)
esbuild
  .build({
    entryPoints: ["src/browser/index.ts"],
    outdir: "dist/browser-esm",
    format: "esm",
    target: ["es2020"],
    platform: "browser",
    tsconfig: "tsconfig.json",
    bundle: false,
    minify: false,
    sourcemap: true,
  })
  .catch(() => process.exit(1));
