import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveMcpUri } from '../utils/uri-resolver.js';

describe('URI Resolver - Task-Attached Resources', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = process.env.BACKLOG_DATA_DIR;
    process.env.BACKLOG_DATA_DIR = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (originalEnv) {
      process.env.BACKLOG_DATA_DIR = originalEnv;
    } else {
      delete process.env.BACKLOG_DATA_DIR;
    }
  });

  it('should resolve task-attached resource URI to correct path', () => {
    const uri = 'mcp://backlog/resources/TASK-0068/test-adr.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'TASK-0068', 'test-adr.md'));
  });

  it('should resolve epic-attached resource URI', () => {
    const uri = 'mcp://backlog/resources/EPIC-0002/adr-001.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'EPIC-0002', 'adr-001.md'));
  });

  it('should distinguish task-attached from repository resources', () => {
    const taskResource = 'mcp://backlog/resources/TASK-0068/adr.md';
    const repoResource = 'mcp://backlog/resources/src/server.ts';
    
    const taskPath = resolveMcpUri(taskResource);
    const repoPath = resolveMcpUri(repoResource);
    
    // Task resource should go to BACKLOG_DATA_DIR/resources
    expect(taskPath).toContain(testDir);
    expect(taskPath).toContain('resources/TASK-0068');
    
    // Repo resource should go to repository root
    expect(repoPath).not.toContain(testDir);
    expect(repoPath).toContain('src/server.ts');
  });

  it('should handle nested paths in task resources', () => {
    const uri = 'mcp://backlog/resources/TASK-0068/docs/adr-001.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'TASK-0068', 'docs', 'adr-001.md'));
  });
});

describe('Resource Reader - Task-Attached Resources', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = process.env.BACKLOG_DATA_DIR;
    process.env.BACKLOG_DATA_DIR = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (originalEnv) {
      process.env.BACKLOG_DATA_DIR = originalEnv;
    } else {
      delete process.env.BACKLOG_DATA_DIR;
    }
  });

  it('should read task-attached markdown resource', async () => {
    const { readMcpResource } = await import('../resources/resource-reader.js');
    
    // Create test resource
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'test.md'),
      '# Test ADR\n\nContent here.',
      'utf-8'
    );
    
    const uri = 'mcp://backlog/resources/TASK-0068/test.md';
    const result = readMcpResource(uri);
    
    expect(result.content).toBe('# Test ADR\n\nContent here.');
    expect(result.mimeType).toBe('text/markdown');
  });

  it('should parse frontmatter in markdown resources', async () => {
    const { readMcpResource } = await import('../resources/resource-reader.js');
    
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'adr.md'),
      '---\ntitle: Test ADR\nstatus: Accepted\n---\n\n# Content',
      'utf-8'
    );
    
    const uri = 'mcp://backlog/resources/TASK-0068/adr.md';
    const result = readMcpResource(uri);
    
    expect(result.content).toBe('\n# Content');
    expect(result.frontmatter).toEqual({ title: 'Test ADR', status: 'Accepted' });
    expect(result.mimeType).toBe('text/markdown');
  });

  it('should throw error for non-existent resource', async () => {
    const { readMcpResource } = await import('../resources/resource-reader.js');
    
    const uri = 'mcp://backlog/resources/TASK-9999/missing.md';
    
    expect(() => readMcpResource(uri)).toThrow('Resource not found');
  });

  it('should handle different file types', async () => {
    const { readMcpResource } = await import('../resources/resource-reader.js');
    
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    
    // JSON file
    writeFileSync(join(resourceDir, 'data.json'), '{"key": "value"}', 'utf-8');
    const jsonResult = readMcpResource('mcp://backlog/resources/TASK-0068/data.json');
    expect(jsonResult.mimeType).toBe('application/json');
    
    // Text file
    writeFileSync(join(resourceDir, 'notes.txt'), 'Plain text', 'utf-8');
    const txtResult = readMcpResource('mcp://backlog/resources/TASK-0068/notes.txt');
    expect(txtResult.mimeType).toBe('text/plain');
  });

  it('should reproduce viewer endpoint failure - file exists but not found', async () => {
    const { readMcpResource } = await import('../resources/resource-reader.js');
    
    // Create the exact file that's failing in production
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'test-adr.md'),
      '# Test ADR\n\nThis is a test.',
      'utf-8'
    );
    
    // Verify file exists
    expect(existsSync(join(resourceDir, 'test-adr.md'))).toBe(true);
    
    // Try to read it via the same URI that's failing
    const uri = 'mcp://backlog/resources/TASK-0068/test-adr.md';
    
    // This should NOT throw - if it does, we reproduced the bug
    expect(() => readMcpResource(uri)).not.toThrow();
    
    const result = readMcpResource(uri);
    expect(result.content).toContain('Test ADR');
  });

  it('should work with actual production BACKLOG_DATA_DIR', async () => {
    // Save original
    const original = process.env.BACKLOG_DATA_DIR;
    
    // Set to production value
    process.env.BACKLOG_DATA_DIR = '/Users/gkoreli/Documents/goga/.backlog';
    
    // Import fresh modules with production env
    const { resolveMcpUri } = await import('../utils/uri-resolver.js');
    const { readMcpResource } = await import('../resources/resource-reader.js');
    
    const uri = 'mcp://backlog/resources/TASK-0068/test-adr.md';
    const resolved = resolveMcpUri(uri);
    
    expect(resolved).toBe('/Users/gkoreli/Documents/goga/.backlog/resources/TASK-0068/test-adr.md');
    
    // Check if file actually exists at production path
    if (existsSync(resolved)) {
      const result = readMcpResource(uri);
      expect(result.content).toBeTruthy();
    }
    
    // Restore
    if (original) {
      process.env.BACKLOG_DATA_DIR = original;
    } else {
      delete process.env.BACKLOG_DATA_DIR;
    }
  });
});

describe('Lifecycle Management', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = process.env.BACKLOG_DATA_DIR;
    process.env.BACKLOG_DATA_DIR = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (originalEnv) {
      process.env.BACKLOG_DATA_DIR = originalEnv;
    } else {
      delete process.env.BACKLOG_DATA_DIR;
    }
  });

  it('should delete resources when task is deleted', async () => {
    const { storage } = await import('../storage/backlog.js');
    storage.init(testDir);
    
    // Create task
    const task = {
      id: 'TASK-9999',
      title: 'Test Task',
      status: 'open' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    storage.add(task);
    
    // Create resource
    const resourceDir = join(testDir, 'resources', 'TASK-9999');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(join(resourceDir, 'test.md'), '# Test', 'utf-8');
    
    expect(existsSync(resourceDir)).toBe(true);
    
    // Delete task
    storage.delete('TASK-9999');
    
    // Resources should be deleted too
    expect(existsSync(resourceDir)).toBe(false);
  });

  it('should handle task deletion when no resources exist', async () => {
    const { storage } = await import('../storage/backlog.js');
    storage.init(testDir);
    
    const task = {
      id: 'TASK-9998',
      title: 'Test Task',
      status: 'open' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    storage.add(task);
    
    // Delete task (no resources)
    expect(() => storage.delete('TASK-9998')).not.toThrow();
  });

  it('should create resource file via write_resource tool simulation', async () => {
    // Simulate what the MCP tool does
    const uri = 'mcp://backlog/resources/TASK-0072/adr-001.md';
    const content = '# ADR 001: Test Decision\n\n## Context\nTesting task-attached resources.\n\n## Decision\nUse separate resources directory.';
    
    const { resolveMcpUri } = await import('../utils/uri-resolver.js');
    const filePath = resolveMcpUri(uri);
    const fileDir = dirname(filePath);
    
    // Create directory
    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }
    
    // Write file
    writeFileSync(filePath, content, 'utf-8');
    
    // Verify
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });
});
