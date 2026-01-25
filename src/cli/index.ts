#!/usr/bin/env node

try { await import('dotenv/config'); } catch {}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'serve') {
  // HTTP server mode
  const { startHttpServer } = await import('../server/fastify-server.js');
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  await startHttpServer(port);
} else if (command === '--help' || command === '-h') {
  console.log(`
backlog-mcp - Task management MCP server

Usage:
  backlog-mcp              Run as stdio MCP server (auto-bridges to HTTP server)
  backlog-mcp serve        Run as HTTP MCP server with viewer
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
