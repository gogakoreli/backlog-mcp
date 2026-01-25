import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { storage } from '../storage/backlog.js';
import { readMcpResource } from '../resources/resource-reader.js';
import { resolveMcpUri, filePathToMcpUri } from '../utils/uri-resolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function registerViewerRoutes(app: FastifyInstance) {
  // Static files
  app.register(fastifyStatic, {
    root: join(__dirname, '..', '..', 'viewer'),
    prefix: '/',
  });

  // List tasks
  app.get('/tasks', async (request) => {
    const { filter, limit } = request.query as { filter?: string; limit?: string };
    
    const statusMap: Record<string, any> = {
      active: { status: ['open', 'in_progress', 'blocked'] },
      done: { status: ['done'] },
      cancelled: { status: ['cancelled'] },
      all: {},
    };
    
    const filterConfig = statusMap[filter || 'active'] || statusMap.active;
    const tasks = storage.list({ ...filterConfig, limit: limit ? parseInt(limit) : 100 });
    
    return tasks;
  });

  // Get single task
  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = storage.get(id);
    
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    
    return task;
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
        mcpUri: filePathToMcpUri(filePath),
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
      const resource = await readMcpResource(uri);
      const filePath = resolveMcpUri(uri);
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
