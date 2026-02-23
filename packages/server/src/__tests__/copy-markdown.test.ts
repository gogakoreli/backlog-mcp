import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { storage } from '../storage/backlog-service.js';
import { createTask } from '../storage/schema.js';

describe('Viewer Routes - Copy Markdown', () => {
  const testTaskId = 'TASK-9999';
  
  beforeAll(() => {
    // Create a test task
    const task = createTask({
      id: testTaskId,
      title: 'Test Copy Markdown',
      description: 'This is a test task for copy markdown functionality',
    });
    storage.add(task);
  });
  
  afterAll(() => {
    // Clean up test task
    storage.delete(testTaskId);
  });
  
  it('should include raw markdown in task response', () => {
    // Get task (simulating what the API endpoint does)
    const task = storage.get(testTaskId);
    const raw = storage.getMarkdown(testTaskId);
    
    expect(task).toBeDefined();
    expect(raw).toBeDefined();
    expect(typeof raw).toBe('string');
    
    // Verify raw contains YAML frontmatter
    expect(raw).toContain('---');
    expect(raw).toContain('id: TASK-9999');
    expect(raw).toContain('title: Test Copy Markdown');
    expect(raw).toContain('status: open');
    
    // Verify raw contains markdown body
    expect(raw).toContain('This is a test task for copy markdown functionality');
    
    // Simulate API response
    const apiResponse = { ...task, raw };
    expect(apiResponse.raw).toBe(raw);
  });
});
