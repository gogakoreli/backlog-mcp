import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { ResourceManager } from '../resources/manager.js';

describe('ResourceManager - Pure Catch-All Design', () => {
  let testDir: string;
  let manager: ResourceManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `backlog-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'tasks'), { recursive: true });
    mkdirSync(join(testDir, 'resources'), { recursive: true });
    
    // Create test files
    writeFileSync(join(testDir, 'tasks', 'TASK-0001.md'), '---\nid: TASK-0001\n---\n# Task 1');
    writeFileSync(join(testDir, 'resources', 'test.md'), '# Test Resource');
    writeFileSync(join(testDir, 'resources', 'data.json'), '{"key": "value"}');
    
    manager = new ResourceManager(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('resolve() - URI to file path', () => {
    it('should resolve URI to file path with pure catch-all', () => {
      const uri = 'mcp://backlog/tasks/TASK-0001.md';
      const path = manager.resolve(uri);
      expect(path).toBe(join(testDir, 'tasks', 'TASK-0001.md'));
    });

    it('should handle nested paths', () => {
      const uri = 'mcp://backlog/resources/nested/file.md';
      const path = manager.resolve(uri);
      expect(path).toBe(join(testDir, 'resources', 'nested', 'file.md'));
    });

    it('should NOT add .md extension automatically', () => {
      const uri = 'mcp://backlog/tasks/TASK-0001';
      const path = manager.resolve(uri);
      expect(path).toBe(join(testDir, 'tasks', 'TASK-0001'));
      expect(path).not.toContain('.md');
    });

    it('should give helpful error for extension-less task URIs', () => {
      const uri = 'mcp://backlog/tasks/TASK-0001';
      expect(() => manager.read(uri)).toThrow('Task URIs must include .md extension');
      expect(() => manager.read(uri)).toThrow('Did you mean: mcp://backlog/tasks/TASK-0001.md?');
    });

    it('should throw on invalid URI scheme', () => {
      expect(() => manager.resolve('http://backlog/tasks')).toThrow('Not an MCP URI');
    });

    it('should throw on invalid hostname', () => {
      expect(() => manager.resolve('mcp://other/tasks')).toThrow('Invalid hostname');
    });

    it('should throw on path traversal', () => {
      expect(() => manager.resolve('mcp://backlog/../etc/passwd')).toThrow('Path traversal');
      expect(() => manager.resolve('mcp://backlog/tasks/../../etc/passwd')).toThrow('Path traversal');
    });
  });

  describe('read() - Read resource content', () => {
    it('should read markdown file with frontmatter', () => {
      const uri = 'mcp://backlog/tasks/TASK-0001.md';
      const resource = manager.read(uri);
      
      expect(resource.content).toBe('# Task 1');
      expect(resource.frontmatter).toEqual({ id: 'TASK-0001' });
      expect(resource.mimeType).toBe('text/markdown');
    });

    it('should read markdown file without frontmatter', () => {
      const uri = 'mcp://backlog/resources/test.md';
      const resource = manager.read(uri);
      
      expect(resource.content).toBe('# Test Resource');
      expect(resource.frontmatter).toBeUndefined();
      expect(resource.mimeType).toBe('text/markdown');
    });

    it('should read JSON file', () => {
      const uri = 'mcp://backlog/resources/data.json';
      const resource = manager.read(uri);
      
      expect(resource.content).toBe('{"key": "value"}');
      expect(resource.mimeType).toBe('application/json');
    });

    it('should throw on non-existent file', () => {
      const uri = 'mcp://backlog/missing.md';
      expect(() => manager.read(uri)).toThrow('not found');
    });

    it('should detect MIME types correctly', () => {
      const testCases = [
        { uri: 'mcp://backlog/file.md', expected: 'text/markdown' },
        { uri: 'mcp://backlog/file.json', expected: 'application/json' },
        { uri: 'mcp://backlog/file.ts', expected: 'text/typescript' },
        { uri: 'mcp://backlog/file.js', expected: 'application/javascript' },
        { uri: 'mcp://backlog/file.txt', expected: 'text/plain' },
        { uri: 'mcp://backlog/file.unknown', expected: 'text/plain' },
      ];

      testCases.forEach(({ uri, expected }) => {
        const path = manager.resolve(uri);
        writeFileSync(path, 'test content');
        const resource = manager.read(uri);
        expect(resource.mimeType).toBe(expected);
      });
    });
  });

  describe('toUri() - File path to URI (optional)', () => {
    it('should convert file path to URI', () => {
      const filePath = join(testDir, 'tasks', 'TASK-0001.md');
      const uri = manager.toUri(filePath);
      expect(uri).toBe('mcp://backlog/tasks/TASK-0001.md');
    });

    it('should handle nested paths', () => {
      const filePath = join(testDir, 'resources', 'nested', 'file.md');
      const uri = manager.toUri(filePath);
      expect(uri).toBe('mcp://backlog/resources/nested/file.md');
    });

    it('should return null for paths outside data directory', () => {
      const uri = manager.toUri('/some/other/path/file.md');
      expect(uri).toBeNull();
    });

    it('should NOT strip .md extension', () => {
      const filePath = join(testDir, 'tasks', 'TASK-0001.md');
      const uri = manager.toUri(filePath);
      expect(uri).toBe('mcp://backlog/tasks/TASK-0001.md');
      expect(uri).toContain('.md');
    });
  });

  describe('write() - Write resource content', () => {
    it('should reject create on existing TASK file', () => {
      const result = manager.write('mcp://backlog/tasks/TASK-0001.md', {
        type: 'create',
        file_text: '# Overwrite attempt',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject create on existing ARTF file', () => {
      writeFileSync(join(testDir, 'tasks', 'ARTF-0001.md'), '---\nid: ARTF-0001\n---\n# Artifact');
      const result = manager.write('mcp://backlog/tasks/ARTF-0001.md', {
        type: 'create',
        file_text: '# Overwrite attempt',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject create on existing FLDR file', () => {
      writeFileSync(join(testDir, 'tasks', 'FLDR-0001.md'), '---\nid: FLDR-0001\n---\n# Folder');
      const result = manager.write('mcp://backlog/tasks/FLDR-0001.md', {
        type: 'create',
        file_text: '# Overwrite attempt',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject create on existing MLST file', () => {
      writeFileSync(join(testDir, 'tasks', 'MLST-0001.md'), '---\nid: MLST-0001\n---\n# Milestone');
      const result = manager.write('mcp://backlog/tasks/MLST-0001.md', {
        type: 'create',
        file_text: '# Overwrite attempt',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should allow str_replace on task files', () => {
      const result = manager.write('mcp://backlog/tasks/TASK-0001.md', {
        type: 'str_replace',
        old_str: '# Task 1',
        new_str: '# Task 1 Updated',
      });
      expect(result.success).toBe(true);
    });

    it('should allow create on resource files', () => {
      const result = manager.write('mcp://backlog/resources/new-doc.md', {
        type: 'create',
        file_text: '# New Resource',
      });
      expect(result.success).toBe(true);
    });

    it('should preserve frontmatter after str_replace', () => {
      manager.write('mcp://backlog/tasks/TASK-0001.md', {
        type: 'str_replace',
        old_str: '# Task 1',
        new_str: '# Task 1 Updated',
      });
      const resource = manager.read('mcp://backlog/tasks/TASK-0001.md');
      expect(resource.frontmatter?.id).toBe('TASK-0001');
      expect(resource.content).toContain('# Task 1 Updated');
    });
  });

  describe('Round-trip consistency', () => {
    it('should round-trip URI → path → URI', () => {
      const originalUri = 'mcp://backlog/tasks/TASK-0001.md';
      const path = manager.resolve(originalUri);
      const roundTripUri = manager.toUri(path);
      expect(roundTripUri).toBe(originalUri);
    });

    it('should round-trip for nested paths', () => {
      const originalUri = 'mcp://backlog/resources/nested/file.md';
      const path = manager.resolve(originalUri);
      const roundTripUri = manager.toUri(path);
      expect(roundTripUri).toBe(originalUri);
    });
  });
});
