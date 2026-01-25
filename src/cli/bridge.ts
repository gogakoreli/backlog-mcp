#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { ensureServer } from './server-manager.js';

async function runBridge(port: number): Promise<void> {
  await ensureServer(port);
  
  const serverUrl = `http://localhost:${port}/mcp`;
  
  // mcp-remote is installed as a dependency, so we can call it directly
  const bridge = spawn('mcp-remote', [serverUrl, '--allow-http'], {
    stdio: 'inherit',
    shell: true // Allows finding mcp-remote in node_modules/.bin
  });
  
  bridge.on('exit', (code) => process.exit(code || 0));
}

const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
runBridge(port).catch((error) => {
  console.error('Bridge error:', error);
  process.exit(1);
});
