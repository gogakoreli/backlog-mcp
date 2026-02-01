import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { storage } from '../storage/backlog-service.js';
import { resourceManager } from '../resources/manager.js';
import { paths } from '../utils/paths.js';

export function registerViewerRoutes(app: FastifyInstance) {
  // Static files - serve from dist/viewer (built assets)
  app.register(fastifyStatic, {
    root: paths.viewerDist,
    prefix: '/',
  });

  // List tasks
  app.get('/tasks', async (request) => {
    const { filter, limit, q } = request.query as { filter?: string; limit?: string; q?: string };
    
    const statusMap: Record<string, any> = {
      active: { status: ['open', 'in_progress', 'blocked'] },
      completed: { status: ['done', 'cancelled'] },
      all: {},
    };
    
    const filterConfig = statusMap[filter || 'active'] || statusMap.active;
    const tasks = await storage.list({ 
      ...filterConfig, 
      query: q || undefined,
      limit: limit ? parseInt(limit) : 10000 
    });
    
    return tasks;
  });

  // Unified search API - returns proper SearchResult[] with item, score, type
  app.get('/search', async (request, reply) => {
    const { q, types, limit } = request.query as { q?: string; types?: string; limit?: string };
    
    if (!q) {
      return reply.code(400).send({ error: 'Missing required query parameter: q' });
    }
    
    const typeFilter = types 
      ? types.split(',').filter((t): t is 'task' | 'epic' | 'resource' => 
          t === 'task' || t === 'epic' || t === 'resource')
      : undefined;
    
    const results = await storage.searchUnified(q, {
      types: typeFilter?.length ? typeFilter : undefined,
      limit: limit ? parseInt(limit) : 20,
    });
    
    return results;
  });

  // Get single task
  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = storage.get(id);
    
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    
    // Include raw markdown for copy button
    const raw = storage.getMarkdown(id);
    
    return { ...task, raw };
  });

  // System status
  app.get('/api/status', async () => {
    const tasks = await storage.list({ limit: 10000 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3030;
    
    return {
      version: paths.getVersion(),
      port,
      dataDir: paths.backlogDataDir,
      taskCount: tasks.length,
      uptime: Math.floor(process.uptime())
    };
  });

  // Open task in editor
  app.get('/open/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = storage.getFilePath(id);
    
    if (!filePath) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    
    exec(`open "${filePath}"`);
    return { status: 'Opening...' };
  });

  // Resource proxy
  app.get('/resource', async (request, reply) => {
    const { path: filePath } = request.query as { path?: string };
    
    if (!filePath) {
      return reply.code(400).send({ error: 'Missing path parameter' });
    }
    
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found', path: filePath });
    }
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
      const mimeMap: Record<string, string> = {
        md: 'text/markdown',
        ts: 'text/typescript',
        js: 'text/javascript',
        json: 'application/json',
        txt: 'text/plain',
      };
      
      let frontmatter = {};
      let bodyContent = content;
      
      // Parse frontmatter for markdown files
      if (ext === 'md') {
        const parsed = matter(content);
        frontmatter = parsed.data;
        bodyContent = parsed.content;
      }
      
      return {
        content: bodyContent,
        frontmatter,
        type: mimeMap[ext] || 'text/plain',
        path: filePath,
        fileUri: `file://${filePath}`,
        mcpUri: resourceManager.toUri(filePath),
        ext
      };
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to read file', message: error.message });
    }
  });

  // MCP resource proxy
  app.get('/mcp/resource', async (request, reply) => {
    const { uri } = request.query as { uri?: string };
    
    if (!uri || !uri.startsWith('mcp://backlog/')) {
      return reply.code(400).send({ error: 'Invalid MCP URI' });
    }
    
    try {
      const resource = resourceManager.read(uri);
      const filePath = resourceManager.resolve(uri);
      const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
      
      return {
        content: resource.content,
        frontmatter: resource.frontmatter || {},
        type: resource.mimeType,
        path: filePath,
        fileUri: `file://${filePath}`,
        mcpUri: uri,
        ext
      };
    } catch (error: any) {
      return reply.code(404).send({ error: 'Resource not found', uri, message: error.message });
    }
  });

  // Open resource in viewer
  app.get('/open', async (request, reply) => {
    const { uri } = request.query as { uri?: string };
    
    if (!uri) {
      return reply.code(400).send({ error: 'Missing uri parameter' });
    }
    
    return reply.redirect(`/?resource=${encodeURIComponent(uri)}`);
  });
}
