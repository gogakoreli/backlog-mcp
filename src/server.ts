#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createTask, STATUSES, type Task } from './schema.js';
import { loadBacklog, getTask, listTasks, addTask, saveTask, getTaskCounts, type StorageOptions } from './storage.js';

// ============================================================================
// Server
// ============================================================================

const server = new McpServer({
  name: 'backlog-mcp',
  version: '0.1.0',
});

const storageOptions: StorageOptions = {
  dataDir: process.env.BACKLOG_DATA_DIR ?? 'data',
};

// ============================================================================
// Tools
// ============================================================================

server.tool(
  'backlog_list',
  'List tasks, optionally filtered by status. Use summary=true for counts.',
  {
    status: z.array(z.enum(STATUSES)).optional().describe('Filter by status'),
    summary: z.boolean().optional().describe('Return counts instead of list'),
  },
  async ({ status, summary }) => {
    const tasks = listTasks(status ? { status } : undefined, storageOptions);

    if (summary) {
      const counts = getTaskCounts(storageOptions);
      return { content: [{ type: 'text' as const, text: JSON.stringify(counts, null, 2) }] };
    }

    const list = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  }
);

server.tool(
  'backlog_get',
  'Get a task by ID',
  { id: z.string().describe('Task ID') },
  async ({ id }) => {
    const task = getTask(id, storageOptions);
    if (!task) {
      return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  'backlog_create',
  'Create a new task',
  {
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
  },
  async ({ title, description }) => {
    const backlog = loadBacklog(storageOptions);
    const task = createTask({ title, description }, backlog.tasks);
    addTask(task, storageOptions);
    return { content: [{ type: 'text' as const, text: `Created ${task.id}` }] };
  }
);

server.tool(
  'backlog_update',
  'Update a task (any field)',
  {
    id: z.string().describe('Task ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    blocked_reason: z.string().optional(),
    evidence: z.array(z.string()).optional(),
  },
  async ({ id, ...updates }) => {
    const task = getTask(id, storageOptions);
    if (!task) {
      return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
    }

    const updated: Task = {
      ...task,
      ...Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined)),
      updated_at: new Date().toISOString(),
    };

    saveTask(updated, storageOptions);
    return { content: [{ type: 'text' as const, text: `Updated ${id}` }] };
  }
);

// ============================================================================
// Main
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
