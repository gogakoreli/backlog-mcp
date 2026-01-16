import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

export async function startViewer(dataDir: string, port: number = 3030): Promise<void> {
  if (await isPortInUse(port)) {
    console.error(`Backlog viewer already running on port ${port}`);
    return;
  }
  
  const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    const pathname = req.url?.split('?')[0];
    if (pathname === '/') {
      const htmlPath = join(__dirname, '..', 'viewer', 'index.html');
      try {
        const html = readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Viewer not found');
      }
      return;
    }
    
    // Serve static files
    if (req.url?.match(/\.(css|js|svg)$/)) {
      const urlPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
      const projectRoot = __dirname.endsWith('src') ? join(__dirname, '..') : join(__dirname, '..');
      // Try dist/viewer (compiled JS), then viewer/ (source assets)
      let filePath = join(projectRoot, 'dist', 'viewer', urlPath);
      if (!existsSync(filePath)) {
        filePath = join(projectRoot, 'viewer', urlPath);
      }
      
      try {
        const content = readFileSync(filePath, 'utf-8');
        const contentType = req.url.endsWith('.css') ? 'text/css' :
                           req.url.endsWith('.js') ? 'application/javascript' :
                           req.url.endsWith('.svg') ? 'image/svg+xml' :
                           'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
    }
    
    // GET /tasks
    if (req.url === '/tasks' || req.url?.startsWith('/tasks?')) {
      const url = new URL(req.url || '/tasks', `http://localhost:${port}`);
      const statusParam = url.searchParams.get('status');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      
      const statuses = statusParam ? statusParam.split(',') : null;
      const tasks = loadTasks(dataDir, statuses, limit);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
      return;
    }
    
    // GET /tasks/:id
    const taskMatch = req.url?.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch && taskMatch[1]) {
      const taskId = taskMatch[1];
      const { getTask } = await import('./storage.js');
      const task = getTask(taskId, { dataDir });
      
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }
      
      // Add file path
      const isArchived = task.status === 'done' || task.status === 'cancelled';
      const filePath = join(dataDir, isArchived ? 'archive' : 'tasks', `${taskId}.md`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...task, filePath }));
      return;
    }
    
    // GET /open/:id - open file in default editor
    const openMatch = req.url?.match(/^\/open\/([^/]+)$/);
    if (openMatch && openMatch[1]) {
      const taskId = openMatch[1];
      const { getTask } = await import('./storage.js');
      const task = getTask(taskId, { dataDir });
      
      if (!task) {
        res.writeHead(404);
        res.end('Task not found');
        return;
      }
      
      const isArchived = task.status === 'done' || task.status === 'cancelled';
      const filePath = join(dataDir, isArchived ? 'archive' : 'tasks', `${taskId}.md`);
      
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
    console.error(`Backlog viewer: http://localhost:${port}/viewer/`);
  });
}

function loadTasks(dataDir: string, statuses: string[] | null, limit: number) {
  const tasks: any[] = [];
  
  // Load active tasks
  const tasksDir = join(dataDir, 'tasks');
  if (existsSync(tasksDir)) {
    const files = readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    files.forEach(file => {
      const task = parseTaskFile(join(tasksDir, file));
      if (task && (!statuses || statuses.includes(task.status))) {
        tasks.push(task);
      }
    });
  }
  
  // Load archived if needed
  if (!statuses || statuses.some(s => s === 'done' || s === 'cancelled')) {
    const archiveDir = join(dataDir, 'archive');
    if (existsSync(archiveDir)) {
      const files = readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const archived = files
        .map(file => parseTaskFile(join(archiveDir, file)))
        .filter(t => t && (!statuses || statuses.includes(t.status)))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, limit);
      
      tasks.push(...archived);
    }
  }
  
  return tasks;
}

function parseTaskFile(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match || !match[1]) return null;
    
    const lines = match[1].split('\n');
    const task: any = {};
    
    lines.forEach(line => {
      if (line.includes(':')) {
        const parts = line.split(':');
        const key = parts[0];
        if (!key) return;
        const valueParts = parts.slice(1);
        const value = valueParts.join(':').trim().replace(/^['"]|['"]$/g, '');
        task[key.trim()] = value;
      }
    });
    
    return task;
  } catch {
    return null;
  }
}

function loadTaskMarkdown(dataDir: string, taskId: string): string | null {
  const activePath = join(dataDir, 'tasks', `${taskId}.md`);
  if (existsSync(activePath)) {
    return readFileSync(activePath, 'utf-8');
  }
  
  const archivePath = join(dataDir, 'archive', `${taskId}.md`);
  if (existsSync(archivePath)) {
    return readFileSync(archivePath, 'utf-8');
  }
  
  return null;
}
