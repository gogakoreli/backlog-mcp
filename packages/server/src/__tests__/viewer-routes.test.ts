import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../server/hono-app.js';
import type { IBacklogService } from '../storage/service-types.js';
import type { Entity, EntityType } from '@backlog-mcp/shared';

// Mock the paths module
vi.mock('../utils/paths.js', () => ({
  paths: {
    viewerDist: '/tmp/viewer-dist',
    backlogDataDir: '/tmp/backlog-data',
    getVersion: () => '1.0.0',
    packageJson: { name: 'backlog-mcp', version: '1.0.0' },
  },
}));

// Mock operations/index.js to avoid side effects
vi.mock('../operations/index.js', () => ({
  operationLogger: { read: vi.fn(), countForTask: vi.fn() },
  withOperationLogging: (server: any) => server,
}));

function makeService(overrides: Partial<IBacklogService> = {}): IBacklogService {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    getMarkdown: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    counts: vi.fn().mockResolvedValue({ total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} }),
    getMaxId: vi.fn().mockResolvedValue(0),
    searchUnified: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('Viewer Routes - /tasks endpoint', () => {
  let service: IBacklogService;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    service = makeService();
    app = createApp(service);
    vi.clearAllMocks();
  });

  describe('limit behavior', () => {
    it('should return all tasks when filter=all (no artificial limit)', async () => {
      // Create 150 mock tasks (more than the old 100 limit)
      const mockTasks: Entity[] = Array.from({ length: 150 }, (_, i) => ({
        id: `TASK-${String(i + 1).padStart(4, '0')}`,
        title: `Task ${i + 1}`,
        status: i < 75 ? 'open' : 'done',
        type: 'task' as EntityType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      vi.mocked(service.list).mockResolvedValue(mockTasks);

      const response = await app.request('/tasks?filter=all');

      expect(response.status).toBe(200);
      const tasks = await response.json();

      // Should return all 150 tasks, not just 100
      expect(tasks.length).toBe(150);

      // Verify service.list was called without a restrictive limit
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: expect.any(Number),
        })
      );

      // The limit should be high enough to return all tasks
      const callArgs = vi.mocked(service.list).mock.calls[0]?.[0];
      expect(callArgs?.limit).toBeGreaterThanOrEqual(150);
    });

    it('should return all active tasks when filter=active', async () => {
      const mockTasks: Entity[] = Array.from({ length: 120 }, (_, i) => ({
        id: `TASK-${String(i + 1).padStart(4, '0')}`,
        title: `Task ${i + 1}`,
        status: 'open',
        type: 'task' as EntityType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      vi.mocked(service.list).mockResolvedValue(mockTasks);

      const response = await app.request('/tasks?filter=active');

      expect(response.status).toBe(200);
      const tasks = await response.json();

      // Should return all 120 tasks
      expect(tasks.length).toBe(120);
    });

    it('should respect explicit limit parameter', async () => {
      const mockTasks: Entity[] = Array.from({ length: 50 }, (_, i) => ({
        id: `TASK-${String(i + 1).padStart(4, '0')}`,
        title: `Task ${i + 1}`,
        status: 'open',
        type: 'task' as EntityType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      vi.mocked(service.list).mockResolvedValue(mockTasks);

      const response = await app.request('/tasks?filter=all&limit=50');

      expect(response.status).toBe(200);

      // Verify explicit limit is passed through
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
        })
      );
    });

    it('should pass query parameter to service.list', async () => {
      const mockTasks: Entity[] = [{
        id: 'TASK-0001',
        title: 'Fix authentication bug',
        status: 'open',
        type: 'task' as EntityType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }];

      vi.mocked(service.list).mockResolvedValue(mockTasks);

      const response = await app.request('/tasks?filter=all&q=authentication');

      expect(response.status).toBe(200);

      // Verify query is passed to service.list
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'authentication',
        })
      );
    });
  });
});


describe('Viewer Routes - /search endpoint', () => {
  let service: IBacklogService;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    service = makeService();
    app = createApp(service);
    vi.clearAllMocks();
  });

  it('should return 400 when q parameter is missing', async () => {
    const response = await app.request('/search');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing required query param: q' });
  });

  it('should return UnifiedSearchResult[] with proper types', async () => {
    const mockResults = [
      { item: { id: 'TASK-0001', title: 'Test task', status: 'open', type: 'task' as EntityType, created_at: '', updated_at: '' }, score: 0.95, type: 'task' },
      { item: { id: 'EPIC-0001', title: 'Test epic', status: 'open', type: 'epic', created_at: '', updated_at: '' }, score: 0.85, type: 'epic' },
    ];

    vi.mocked(service.searchUnified).mockResolvedValue(mockResults as any);

    const response = await app.request('/search?q=test');

    expect(response.status).toBe(200);
    const results = await response.json();

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('item');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('type');
    expect(results[0].item.id).toBe('TASK-0001');
    expect(results[0].score).toBe(0.95);
    expect(results[0].type).toBe('task');
  });

  it('should pass types filter to searchUnified', async () => {
    vi.mocked(service.searchUnified).mockResolvedValue([]);

    await app.request('/search?q=test&types=task');

    expect(service.searchUnified).toHaveBeenCalledWith('test', expect.objectContaining({
      types: ['task'],
      limit: 20,
    }));
  });

  it('should pass limit parameter to searchUnified', async () => {
    vi.mocked(service.searchUnified).mockResolvedValue([]);

    await app.request('/search?q=test&limit=5');

    expect(service.searchUnified).toHaveBeenCalledWith('test', expect.objectContaining({
      limit: 5,
    }));
  });

  it('should pass sort parameter to searchUnified', async () => {
    vi.mocked(service.searchUnified).mockResolvedValue([]);

    await app.request('/search?q=test&sort=recent');

    expect(service.searchUnified).toHaveBeenCalledWith('test', expect.objectContaining({
      sort: 'recent',
      limit: 20,
    }));
  });
});
