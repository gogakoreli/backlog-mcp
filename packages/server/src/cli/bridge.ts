#!/usr/bin/env node

import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ensureServer } from './server-manager.js';
import { Supervisor, DEFAULT_CONFIG } from './supervisor.js';
import { paths } from '@/utils/paths.js';
import { logger } from '@/utils/logger.js';

async function runBridge(port: number): Promise<void> {
  await ensureServer(port);
  
  const serverUrl = `http://localhost:${port}/mcp`;
  const mcpRemotePath = paths.getBinPath('mcp-remote');
  
  if (!existsSync(mcpRemotePath)) {
    logger.error('mcp-remote not found', { path: mcpRemotePath });
    process.exit(1);
  }
  
  const supervisor = new Supervisor(DEFAULT_CONFIG);
  
  const spawnBridge = () => {
    supervisor.onStart();
    
    const bridge = spawn(mcpRemotePath, [serverUrl, '--allow-http', '--transport', 'http-only'], {
      stdio: ['inherit', 'inherit', 'pipe']
    });
    
    let connectionLost = false;
    
    bridge.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      process.stderr.write(msg);
      
      // mcp-remote hangs on connection errors instead of exiting - detect and kill
      if (!connectionLost && (msg.includes('ECONNREFUSED') || msg.includes('fetch failed'))) {
        connectionLost = true;
        logger.warn('mcp-remote lost connection, restarting');
        bridge.kill();
      }
    });
    
    bridge.on('exit', async (code) => {
      const result = supervisor.onExit(connectionLost ? 1 : code);
      
      if (result.action === 'stop') {
        process.exit(0);
      }
      
      if (result.action === 'give-up') {
        logger.error('mcp-remote crashed too many times', { restarts: result.restartCount });
        process.exit(1);
      }
      
      logger.warn('mcp-remote restarting', { delay: result.delay, attempt: result.restartCount });
      
      await ensureServer(port).catch(() => {});
      setTimeout(spawnBridge, result.delay);
    });
  };
  
  spawnBridge();
}

const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
runBridge(port).catch((error) => {
  logger.error('Bridge error', { error: String(error) });
  process.exit(1);
});
