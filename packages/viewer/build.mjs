import { build, context } from 'esbuild';

const shared = {
  entryPoints: [
    { in: 'main.ts', out: 'main' },
    { in: 'index.html', out: 'index' },
    { in: 'logo.svg', out: 'logo' },
  ],
  bundle: true,
  format: 'esm',
  outdir: 'dist',
  assetNames: '[name]-[hash]',
  alias: { '@framework': './framework' },
  loader: {
    '.css': 'css',
    '.svg': 'file',
    '.html': 'copy',
  },
};

// Per-entry loader override: logo.svg uses copy, all other .svg uses file
const logoPlugin = {
  name: 'logo-copy',
  setup(build) {
    build.onLoad({ filter: /logo\.svg$/ }, async (args) => ({
      contents: await import('fs').then(fs => fs.readFileSync(args.path)),
      loader: 'copy',
    }));
  },
};

const watch = process.argv.includes('--watch');

if (watch) {
  const ctx = await context({ ...shared, plugins: [logoPlugin] });
  await ctx.watch();
  console.log('watching...');
} else {
  await build({ ...shared, plugins: [logoPlugin] });
}
