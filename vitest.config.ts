import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@/utils': resolve(__dirname, './src/utils'),
      '@/server': resolve(__dirname, './src/server'),
      '@/storage': resolve(__dirname, './src/storage'),
      '@/tools': resolve(__dirname, './src/tools'),
      '@/resources': resolve(__dirname, './src/resources'),
      '@/middleware': resolve(__dirname, './src/middleware'),
      '@/cli': resolve(__dirname, './src/cli'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./src/__tests__/helpers/setup.ts'],
  },
});
