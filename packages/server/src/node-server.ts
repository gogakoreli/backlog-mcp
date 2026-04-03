#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './server/hono-app.js';
import { BacklogService } from './storage/backlog-service.js';
import { resourceManager } from './resources/manager.js';
import { operationLogger } from './operations/index.js';
import { withOperationLogging } from './operations/middleware.js';
import { eventBus } from './events/index.js';
import { paths } from './utils/paths.js';
import { logger } from './utils/logger.js';
import { resolveSourcePath } from './utils/resolve-source-path.js';

function readLocalFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try { return readFileSync(filePath, 'utf-8'); } catch { return null; }
}

const service = BacklogService.getInstance();
const port = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');

const app = createApp(service, {
  name: paths.packageJson.name,
  version: paths.getVersion(),
  dataDir: paths.backlogDataDir,
  operationLog: operationLogger,
  wrapMcpServer: withOperationLogging(operationLogger, { eventBus }),
  resourceManager,
  eventBus,
  staticMiddleware: serveStatic({ root: paths.viewerDist }),
  readLocalFile,
  resolveSourcePath,
});

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  logger.info('Server started', { port: info.port, dataDir: paths.backlogDataDir, version: paths.getVersion() });
  console.log(`Backlog MCP server running on http://localhost:${info.port}`);
  console.log(`- Viewer: http://localhost:${info.port}/`);
  console.log(`- MCP endpoint: http://localhost:${info.port}/mcp`);
  console.log(`- Data directory: ${paths.backlogDataDir}`);
});

const shutdown = async () => {
  logger.info('Server shutting down');
  console.log('Shutting down gracefully...');
  server.close();
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
