import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/__tests__/**'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  unbundle: true,
  skipNodeModulesBundle: true,
  noExternal: ['@backlog-mcp/shared'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  logLevel: 'info',
  report: false,
  copy: [
    { from: '../viewer/dist/**', to: 'dist/viewer' },
  ],
});
