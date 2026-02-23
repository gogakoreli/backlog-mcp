import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Manual alias needed: vite-tsconfig-paths doesn't rewrite .js → .ts extensions
      '@framework': resolve(__dirname, './framework'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
  },
});
