import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { paths } from '@/utils/paths.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function isServerRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: 'localhost', port, path: '/version', method: 'GET' }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function getServerVersion(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = request({ host: 'localhost', port, path: '/version', method: 'GET' }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function spawnServer(port: number): Promise<void> {
  const serverPath = join(paths.distRoot, 'server', 'fastify-server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BACKLOG_VIEWER_PORT: String(port) }
  });
  child.unref();
}

async function shutdownServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    const req = request({ host: 'localhost', port, path: '/shutdown', method: 'POST' }, () => {
      resolve();
    });
    req.on('error', () => resolve());
    req.end();
  });
}

async function waitForServer(port: number, timeout: number): Promise<void> {
  const start = Date.now();
  let delay = 100;
  
  while (Date.now() - start < timeout) {
    if (await isServerRunning(port)) return;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 1000);
  }
  
  throw new Error(`Server failed to start within ${timeout}ms`);
}

export async function ensureServer(port: number): Promise<void> {
  const running = await isServerRunning(port);
  
  if (!running) {
    await spawnServer(port);
    await waitForServer(port, 10000);
    return;
  }
  
  const serverVersion = await getServerVersion(port);
  if (serverVersion !== paths.getVersion()) {
    await shutdownServer(port);
    await sleep(1000);
    await spawnServer(port);
    await waitForServer(port, 10000);
  }
}

export { isServerRunning, getServerVersion, shutdownServer };
