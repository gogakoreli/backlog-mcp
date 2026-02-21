import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceManager } from '../resources/manager.js';
import { paths } from '../utils/paths.js';

describe('URI Resolver - Pure Catch-All', () => {
  let testDir: string;
  let manager: ResourceManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    manager = new ResourceManager(testDir);
    
    // Mock paths.backlogDataDir getter
    manager = new ResourceManager(testDir);
    
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should resolve nested resource paths', () => {
    const uri = 'mcp://backlog/resources/TASK-0068/test-adr.md';
    const resolved = manager.resolve(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'TASK-0068', 'test-adr.md'));
  });

  it('should resolve epic resource paths', () => {
    const uri = 'mcp://backlog/resources/EPIC-0002/adr-001.md';
    const resolved = manager.resolve(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'EPIC-0002', 'adr-001.md'));
  });

  it('should resolve all paths to data directory with catch-all pattern', () => {
    const nestedResource = 'mcp://backlog/resources/TASK-0068/adr.md';
    const standaloneResource = 'mcp://backlog/resources/P352408007-investigation.md';
    
    const nestedPath = manager.resolve(nestedResource);
    const standalonePath = manager.resolve(standaloneResource);
    
    expect(nestedPath).toBe(join(testDir, 'resources', 'TASK-0068', 'adr.md'));
    expect(standalonePath).toBe(join(testDir, 'resources', 'P352408007-investigation.md'));
  });

  it('should resolve standalone resource files', () => {
    const uri = 'mcp://backlog/resources/P352408007-investigation.md';
    const resolved = manager.resolve(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'P352408007-investigation.md'));
  });

  it('should handle deeply nested paths', () => {
    const uri = 'mcp://backlog/resources/TASK-0068/docs/adr-001.md';
    const resolved = manager.resolve(uri);
    
    expect(resolved).toBe(join(testDir, 'resources', 'TASK-0068', 'docs', 'adr-001.md'));
  });
});

describe('Resource Reader', () => {
  let testDir: string;
  let manager: ResourceManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    // Mock paths.backlogDataDir getter
    manager = new ResourceManager(testDir);
    
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should read markdown resource', async () => {
    
    
    // Create test resource
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'test.md'),
      '# Test ADR\n\nContent here.',
      'utf-8'
    );
    
    const uri = 'mcp://backlog/resources/TASK-0068/test.md';
    const result = manager.read(uri);
    
    expect(result.content).toBe('# Test ADR\n\nContent here.');
    expect(result.mimeType).toBe('text/markdown');
  });

  it('should parse frontmatter in markdown resources', async () => {
    
    
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(
      join(resourceDir, 'adr.md'),
      '---\ntitle: Test ADR\nstatus: Accepted\n---\n\n# Content',
      'utf-8'
    );
    
    const uri = 'mcp://backlog/resources/TASK-0068/adr.md';
    const result = manager.read(uri);
    
    expect(result.content).toBe('\n# Content');
    expect(result.frontmatter).toEqual({ title: 'Test ADR', status: 'Accepted' });
    expect(result.mimeType).toBe('text/markdown');
  });

  it('should throw error for non-existent resource', async () => {
    
    
    const uri = 'mcp://backlog/resources/TASK-9999/missing.md';
    
    expect(() => manager.read(uri)).toThrow('Resource not found');
  });

  it('should handle different file types', async () => {
    
    
    const resourceDir = join(testDir, 'resources', 'TASK-0068');
    mkdirSync(resourceDir, { recursive: true });
    
    // JSON file
    writeFileSync(join(resourceDir, 'data.json'), '{"key": "value"}', 'utf-8');
    const jsonResult = manager.read('mcp://backlog/resources/TASK-0068/data.json');
    expect(jsonResult.mimeType).toBe('application/json');
    
    // Text file
    writeFileSync(join(resourceDir, 'notes.txt'), 'Plain text', 'utf-8');
    const txtResult = manager.read('mcp://backlog/resources/TASK-0068/notes.txt');
    expect(txtResult.mimeType).toBe('text/plain');
  });

  it('should reproduce viewer endpoint failure - file exists but not found', async () => {
    
    
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
    expect(() => manager.read(uri)).not.toThrow();
    
    const result = manager.read(uri);
    expect(result.content).toContain('Test ADR');
  });

  it('should resolve paths correctly with different data directories', () => {
    const customDir = '/custom/data/dir';
    const customManager = new ResourceManager(customDir);
    
    const uri = 'mcp://backlog/resources/TASK-0068/test-adr.md';
    const resolved = customManager.resolve(uri);
    
    expect(resolved).toBe(join(customDir, 'resources/TASK-0068/test-adr.md'));
  });
});

describe('Lifecycle Management', () => {
  let testDir: string;
  let manager: ResourceManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    // Mock paths.backlogDataDir getter
    manager = new ResourceManager(testDir);
    
    vi.spyOn(paths, 'backlogDataDir', 'get').mockReturnValue(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should delete resources when task is deleted', async () => {
    const { storage } = await import('../storage/backlog-service.js');
    
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
    const { storage } = await import('../storage/backlog-service.js');
    
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

  it('should resolve resource file paths for task-attached resources', async () => {
    // Simulate what the MCP tool does
    const uri = 'mcp://backlog/resources/TASK-0072/adr-001.md';
    const content = '# ADR 001: Test Decision\n\n## Context\nTesting task-attached resources.\n\n## Decision\nUse separate resources directory.';
    
    
    const filePath = manager.resolve(uri);
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
