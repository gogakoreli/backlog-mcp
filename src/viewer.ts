import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { storage } from './backlog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const client = createConnection({ port }, () => {
      client.end();
      resolve(true);
    });
    client.on('error', () => resolve(false));
  });
}

export async function startViewer(port: number = 3030): Promise<void> {
  if (await isPortInUse(port)) {
    console.error(`Backlog viewer already running on port ${port}`);
    return;
  }

  const server = createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Serve index.html for root
    if (req.url === '/' || req.url === '/index.html' || req.url?.startsWith('/?')) {
      const htmlPath = join(__dirname, '..', 'viewer', 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(htmlPath));
      return;
    }
    
    // Serve static files
    const projectRoot = join(__dirname, '..');
    if (req.url?.match(/\.(js|css|svg|png|ico)$/)) {
      const urlPath = req.url.split('?')[0] || '';
      let filePath = join(projectRoot, 'dist', 'viewer', urlPath);
      if (!existsSync(filePath)) {
        filePath = join(projectRoot, 'viewer', urlPath);
      }
      
      if (existsSync(filePath)) {
        const ext = urlPath.split('.').pop() || 'txt';
        const contentType: Record<string, string> = {
          js: 'application/javascript',
          css: 'text/css',
          svg: 'image/svg+xml',
          png: 'image/png',
          ico: 'image/x-icon',
        };
        res.writeHead(200, { 'Content-Type': contentType[ext || 'txt'] || 'text/plain' });
        res.end(readFileSync(filePath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
    }
    
    // GET /tasks
    if (req.url === '/tasks' || req.url?.startsWith('/tasks?')) {
      const url = new URL(req.url || '/tasks', `http://localhost:${port}`);
      const filter = url.searchParams.get('filter') || 'active';
      const limit = parseInt(url.searchParams.get('limit') || '100');
      
      type Status = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
      const statusMap: Record<string, Status[]> = {
        active: ['open', 'in_progress', 'blocked'],
        completed: ['done', 'cancelled'],
        open: ['open'],
        in_progress: ['in_progress'],
        blocked: ['blocked'],
        done: ['done'],
        cancelled: ['cancelled'],
      };
      const statusFilter = filter === 'all' ? { limit } : { status: statusMap[filter], limit };
      const tasks = storage.list(statusFilter);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
      return;
    }
    
    // GET /tasks/:id
    const taskMatch = req.url?.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch && taskMatch[1]) {
      const taskId = taskMatch[1];
      const task = storage.get(taskId);
      
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }
      
      const filePath = storage.getFilePath(taskId);
      const raw = storage.getMarkdown(taskId);
      const epic = task.epic_id ? storage.get(task.epic_id) : null;
      const epicTitle = epic?.title;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...task, filePath, raw, epicTitle }));
      return;
    }
    
    // GET /open/:id - open file in default editor
    const openMatch = req.url?.match(/^\/open\/([^/]+)$/);
    if (openMatch && openMatch[1]) {
      const taskId = openMatch[1];
      const filePath = storage.getFilePath(taskId);
      
      if (!filePath) {
        res.writeHead(404);
        res.end('Task not found');
        return;
      }
      
      const { exec } = await import('node:child_process');
      exec(`open "${filePath}"`);
      
      res.writeHead(200);
      res.end('Opening...');
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(port, () => {
    console.error(`Backlog viewer: http://localhost:${port}`);
  });
}
