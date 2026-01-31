import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerViewerRoutes } from '../server/viewer-routes.js';
import { storage } from '../storage/backlog.js';
import type { Task } from '../storage/schema.js';

// Mock the storage module
vi.mock('../storage/backlog.js', () => ({
  storage: {
    list: vi.fn(),
    get: vi.fn(),
    getMarkdown: vi.fn(),
    getFilePath: vi.fn(),
  },
}));

// Mock the paths module
vi.mock('../utils/paths.js', () => ({
  paths: {
    viewerDist: '/tmp/viewer-dist',
    backlogDataDir: '/tmp/backlog-data',
    getVersion: () => '1.0.0',
  },
}));

// Mock fastify-static to avoid file system issues
vi.mock('@fastify/static', () => ({
  default: vi.fn().mockImplementation(() => Promise.resolve()),
}));

describe('Viewer Routes - /tasks endpoint', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    registerViewerRoutes(app);
    await app.ready();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('limit behavior', () => {
    it('should return all tasks when filter=all (no artificial limit)', async () => {
      // Create 150 mock tasks (more than the old 100 limit)
      const mockTasks: Task[] = Array.from({ length: 150 }, (_, i) => ({
        id: `TASK-${String(i + 1).padStart(4, '0')}`,
        title: `Task ${i + 1}`,
        status: i < 75 ? 'open' : 'done',
        type: 'task',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      vi.mocked(storage.list).mockReturnValue(mockTasks);

      const response = await app.inject({
        method: 'GET',
        url: '/tasks?filter=all',
      });

      expect(response.statusCode).toBe(200);
      const tasks = JSON.parse(response.body);
      
      // Should return all 150 tasks, not just 100
      expect(tasks.length).toBe(150);
      
      // Verify storage.list was called without a restrictive limit
      expect(storage.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: expect.any(Number),
        })
      );
      
      // The limit should be high enough to return all tasks
      const callArgs = vi.mocked(storage.list).mock.calls[0][0];
      expect(callArgs?.limit).toBeGreaterThanOrEqual(150);
    });

    it('should return all active tasks when filter=active', async () => {
      const mockTasks: Task[] = Array.from({ length: 120 }, (_, i) => ({
        id: `TASK-${String(i + 1).padStart(4, '0')}`,
        title: `Task ${i + 1}`,
        status: 'open',
        type: 'task',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      vi.mocked(storage.list).mockReturnValue(mockTasks);

      const response = await app.inject({
        method: 'GET',
        url: '/tasks?filter=active',
      });

      expect(response.statusCode).toBe(200);
      const tasks = JSON.parse(response.body);
      
      // Should return all 120 tasks
      expect(tasks.length).toBe(120);
    });

    it('should respect explicit limit parameter', async () => {
      const mockTasks: Task[] = Array.from({ length: 50 }, (_, i) => ({
        id: `TASK-${String(i + 1).padStart(4, '0')}`,
        title: `Task ${i + 1}`,
        status: 'open',
        type: 'task',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      vi.mocked(storage.list).mockReturnValue(mockTasks);

      const response = await app.inject({
        method: 'GET',
        url: '/tasks?filter=all&limit=50',
      });

      expect(response.statusCode).toBe(200);
      
      // Verify explicit limit is passed through
      expect(storage.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
        })
      );
    });

    it('should pass query parameter to storage.list', async () => {
      const mockTasks: Task[] = [{
        id: 'TASK-0001',
        title: 'Fix authentication bug',
        status: 'open',
        type: 'task',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }];

      vi.mocked(storage.list).mockReturnValue(mockTasks);

      const response = await app.inject({
        method: 'GET',
        url: '/tasks?filter=all&q=authentication',
      });

      expect(response.statusCode).toBe(200);
      
      // Verify query is passed to storage.list
      expect(storage.list).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'authentication',
        })
      );
    });
  });
});
