#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { ensureServer } from './server-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runBridge(port: number): Promise<void> {
  await ensureServer(port);
  
  const serverUrl = `http://localhost:${port}/mcp`;
  
  // Resolve full path to mcp-remote in node_modules/.bin
  const mcpRemotePath = join(__dirname, '..', '..', 'node_modules', '.bin', 'mcp-remote');
  
  if (!existsSync(mcpRemotePath)) {
    console.error('mcp-remote not found. Please run: pnpm install');
    process.exit(1);
  }
  
  const bridge = spawn(mcpRemotePath, [serverUrl, '--allow-http', '--transport', 'http-only'], {
    stdio: 'inherit'
  });
  
  bridge.on('exit', (code) => process.exit(code || 0));
}

const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
runBridge(port).catch((error) => {
  console.error('Bridge error:', error);
  process.exit(1);
});
