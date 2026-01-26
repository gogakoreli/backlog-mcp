#!/usr/bin/env node

import { paths } from '@/utils/paths.js';
import { isServerRunning, getServerVersion, shutdownServer } from './server-manager.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'serve') {
  // HTTP server mode
  const { startHttpServer } = await import('../server/fastify-server.js');
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  await startHttpServer(port);
} else if (command === 'version') {
  // Show version
  console.log(paths.getVersion());
  process.exit(0);
} else if (command === 'status') {
  // Check server status
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  const running = await isServerRunning(port);
  
  if (!running) {
    console.log('Server is not running');
    process.exit(1);
  }
  
  const version = await getServerVersion(port);
  console.log(`Server is running on port ${port}`);
  console.log(`Version: ${version || 'unknown'}`);
  console.log(`Viewer: http://localhost:${port}/`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  process.exit(0);
} else if (command === 'stop') {
  // Stop server
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  const running = await isServerRunning(port);
  
  if (!running) {
    console.log('Server is not running');
    process.exit(0);
  }
  
  console.log(`Stopping server on port ${port}...`);
  await shutdownServer(port);
  console.log('Server stopped');
  process.exit(0);
} else if (command === '--help' || command === '-h') {
  console.log(`
backlog-mcp - Task management MCP server

Usage:
  backlog-mcp              Run as stdio MCP server (auto-bridges to HTTP server)
  backlog-mcp serve        Run as HTTP MCP server with viewer
  backlog-mcp version      Show version
  backlog-mcp status       Check if server is running
  backlog-mcp stop         Stop the server
  backlog-mcp --help       Show this help

Environment variables:
  BACKLOG_DATA_DIR         Data directory path (default: ./data)
  BACKLOG_VIEWER_PORT      HTTP server port (default: 3030)

How it works:
  - Default mode auto-spawns HTTP server and bridges stdio to it
  - HTTP server persists across sessions (shared by multiple clients)
  - Automatic version upgrades on server restart
  `);
  process.exit(0);
} else {
  // Default: bridge mode (auto-spawn HTTP server)
  await import('./bridge.js');
}
