/**
 * Global test setup - mocks node:fs with memfs
 * Tests work unchanged - they just use in-memory fs
 */
import { vi, beforeAll } from 'vitest';
import { fs, vol } from './virtual-fs.js';

// Mock node:fs with memfs
vi.mock('node:fs', () => fs);

// Reset filesystem before each TEST FILE (not each test)
// This preserves state within a file (for beforeAll/afterAll patterns)
const CWD = process.cwd();
beforeAll(() => {
  vol.reset();
  vol.fromJSON({
    [`${CWD}/package.json`]: JSON.stringify({ name: 'backlog-mcp', version: '0.0.0-test' }),
  });
});

export { vol };
