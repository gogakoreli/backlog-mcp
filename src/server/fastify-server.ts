#!/usr/bin/env node

try { await import('dotenv/config'); } catch {}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerViewerRoutes } from './viewer-routes.js';
import { registerMcpHandler } from './mcp-handler.js';
import { authMiddleware } from '../middleware/auth.js';
import { storage } from '../storage/backlog.js';

const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });

// Initialize storage
const dataDir = process.env.BACKLOG_DATA_DIR ?? 'data';
storage.init(dataDir);

// CORS
await app.register(cors, { origin: '*' });

// Auth middleware
app.addHook('preHandler', authMiddleware);

// Register routes
registerViewerRoutes(app);
registerMcpHandler(app);

// Health check
app.get('/health', async () => ({ status: 'ok' }));

// Version endpoint
app.get('/version', async () => {
  const pkg = await import('../../package.json', { assert: { type: 'json' } });
  return pkg.default.version;
});

// Shutdown endpoint
app.post('/shutdown', async (request, reply) => {
  reply.send('Shutting down...');
  setTimeout(() => process.exit(0), 500);
});

export async function startHttpServer(port: number = 3030): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Backlog MCP server running on http://localhost:${port}`);
  console.log(`- Viewer: http://localhost:${port}/`);
  console.log(`- MCP endpoint: http://localhost:${port}/mcp`);
}

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down gracefully...');
  await app.close();
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  startHttpServer(port).catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
