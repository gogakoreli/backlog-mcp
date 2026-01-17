#!/usr/bin/env node

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createTask, STATUSES, type Task } from './schema.js';
import { storage } from './backlog.js';
import { startViewer } from './viewer.js';

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// Init storage
const dataDir = process.env.BACKLOG_DATA_DIR ?? 'data';
storage.init(dataDir);

const server = new McpServer({
  name: 'backlog-mcp',
  version: pkg.version,
});

// ============================================================================
// Tools
// ============================================================================

server.registerTool(
  'backlog_list',
  {
    description: 'List tasks from backlog. Shows open/in_progress/blocked by default. Use status=["done"] to see completed tasks.',
    inputSchema: {
      status: z.array(z.enum(STATUSES)).optional().describe('Filter: open, in_progress, blocked, done, cancelled. Default: open, in_progress, blocked'),
      counts: z.boolean().optional().describe('Return counts per status instead of task list'),
      limit: z.number().optional().describe('Max tasks to return. Default: 20'),
    },
  },
  async ({ status, counts, limit }) => {
    const tasks = storage.list({ status, limit });
    if (counts) {
      return { content: [{ type: 'text' as const, text: JSON.stringify(storage.counts(), null, 2) }] };
    }
    const list = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  }
);

server.registerTool(
  'backlog_get',
  {
    description: 'Get full task details by ID. Works for any task regardless of status.',
    inputSchema: {
      id: z.union([z.string(), z.array(z.string())]).describe('Task ID like TASK-0001, or array for batch fetch'),
    },
  },
  async ({ id }) => {
    const taskIds = Array.isArray(id) ? id : [id];
    if (taskIds.length === 0) {
      return { content: [{ type: 'text' as const, text: 'Required: id' }], isError: true };
    }
    const results = taskIds.map((tid) => storage.getMarkdown(tid) || `Not found: ${tid}`);
    return { content: [{ type: 'text' as const, text: results.join('\n\n---\n\n') }] };
  }
);

server.registerTool(
  'backlog_create',
  {
    description: 'Create a new task in the backlog.',
    inputSchema: {
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description in markdown'),
    },
  },
  async ({ title, description }) => {
    const task = createTask({ title, description }, storage.list());
    storage.add(task);
    return { content: [{ type: 'text' as const, text: `Created ${task.id}` }] };
  }
);

server.registerTool(
  'backlog_update',
  {
    description: 'Update an existing task.',
    inputSchema: {
      id: z.string().describe('Task ID to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(STATUSES).optional().describe('New status'),
      blocked_reason: z.string().optional().describe('Reason if status is blocked'),
      evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
    },
  },
  async ({ id, title, description, status, blocked_reason, evidence }) => {
    const task = storage.get(id);
    if (!task) {
      return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
    }
    const updates = { title, description, status, blocked_reason, evidence };
    const updated: Task = {
      ...task,
      ...Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined)),
      updated_at: new Date().toISOString(),
    };
    storage.save(updated);
    return { content: [{ type: 'text' as const, text: `Updated ${id}` }] };
  }
);

server.registerTool(
  'backlog_delete',
  {
    description: 'Permanently delete a task from the backlog.',
    inputSchema: {
      id: z.string().describe('Task ID to delete'),
    },
  },
  async ({ id }) => {
    const deleted = storage.delete(id);
    if (!deleted) {
      return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: `Deleted ${id}` }] };
  }
);

// ============================================================================
// Main
// ============================================================================

async function main() {
  const viewerPort = parseInt(process.env.BACKLOG_VIEWER_PORT || '3030');
  startViewer(viewerPort);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
