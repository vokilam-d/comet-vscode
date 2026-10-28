import * as esbuild from 'esbuild';
import * as fs from 'node:fs/promises';

/**
 * @stylistic/eslint-plugin loads its CJS vendor code through `createRequire(import.meta.url)`, which esbuild
 * can't follow; plain `require` calls get bundled.
 */
const stylisticRequire = {
  name: 'stylistic-require',
  setup(build) {
    build.onLoad({ filter: /@stylistic[\\/]eslint-plugin[\\/]dist[\\/]vendor\.js$/ }, async args => ({
      contents: (await fs.readFile(args.path, 'utf8')).replaceAll('__require(', 'require('),
      loader: 'js',
    }));
  },
};

const production = process.argv.includes('--production');

export const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  plugins: [stylisticRequire],
  // The packaged build is minified; names are kept so stack traces in the Comet output stay readable.
  minify: production,
  keepNames: true,
  sourcemap: !production,
  logLevel: 'info',
};

if (process.argv[1]?.endsWith('esbuild.mjs')) {
  if (process.argv.includes('--watch')) {
    await (await esbuild.context(options)).watch();
  } else {
    await esbuild.build(options);
  }
}
