import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the function under test — we need to extract it or test via the tool
// Since resolveSourcePath is not exported, test it indirectly through the tool behavior
// by importing and calling the module's logic

// For unit testing, replicate the resolution logic or export it.
// Let's test by importing the function directly after making it exported.

describe('source_path for backlog_create', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-source-path-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // We test resolveSourcePath directly
  it('should read file content from absolute path', async () => {
    const { resolveSourcePath } = await import('../tools/backlog-create.js');
    const filePath = join(testDir, 'test.md');
    writeFileSync(filePath, '# Hello\n\nThis is test content.');
    expect(resolveSourcePath(filePath)).toBe('# Hello\n\nThis is test content.');
  });

  it('should throw for non-existent file', async () => {
    const { resolveSourcePath } = await import('../tools/backlog-create.js');
    expect(() => resolveSourcePath('/nonexistent/file.md')).toThrow('File not found');
  });

  it('should throw for directory path', async () => {
    const { resolveSourcePath } = await import('../tools/backlog-create.js');
    expect(() => resolveSourcePath(testDir)).toThrow('Not a file');
  });

  it('should handle tilde expansion', async () => {
    const { resolveSourcePath } = await import('../tools/backlog-create.js');
    // This test just verifies tilde doesn't crash — actual home dir content varies
    expect(() => resolveSourcePath('~/nonexistent-backlog-test-file-xyz.md')).toThrow('File not found');
  });

  it('should read large file content without truncation', async () => {
    const { resolveSourcePath } = await import('../tools/backlog-create.js');
    const filePath = join(testDir, 'large.md');
    const largeContent = 'Line of content for testing.\n'.repeat(10000);
    writeFileSync(filePath, largeContent);
    expect(resolveSourcePath(filePath)).toBe(largeContent);
  });
});
