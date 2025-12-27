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

const ACTIONS = ['list', 'get', 'create', 'update'] as const;

server.registerTool(
  'backlog',
  {
    description: 'Manage tasks. Actions: list, get, create, update',
    inputSchema: {
      action: z.enum(ACTIONS).describe('Action to perform'),
      // list options
      status: z.array(z.enum(STATUSES)).optional().describe('Filter by status (list)'),
      summary: z.boolean().optional().describe('Return counts instead of list (list)'),
      // get/update options
      id: z.string().optional().describe('Task ID (get, update)'),
      // create/update options
      title: z.string().optional().describe('Task title (create, update)'),
      description: z.string().optional().describe('Task description (create, update)'),
      // update-only options
      set_status: z.enum(STATUSES).optional().describe('New status (update)'),
      blocked_reason: z.string().optional().describe('Reason for blocked status (update)'),
      evidence: z.array(z.string()).optional().describe('Evidence of completion (update)'),
    },
  },
  async ({ action, status, summary, id, title, description, set_status, blocked_reason, evidence }) => {
    switch (action) {
      case 'list': {
        const tasks = listTasks(status ? { status } : undefined, storageOptions);
        if (summary) {
          const counts = getTaskCounts(storageOptions);
          return { content: [{ type: 'text' as const, text: JSON.stringify(counts, null, 2) }] };
        }
        const list = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
      }

      case 'get': {
        if (!id) {
          return { content: [{ type: 'text' as const, text: 'Missing required: id' }], isError: true };
        }
        const task = getTask(id, storageOptions);
        if (!task) {
          return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
      }

      case 'create': {
        if (!title) {
          return { content: [{ type: 'text' as const, text: 'Missing required: title' }], isError: true };
        }
        const backlog = loadBacklog(storageOptions);
        const task = createTask({ title, description }, backlog.tasks);
        addTask(task, storageOptions);
        return { content: [{ type: 'text' as const, text: `Created ${task.id}` }] };
      }

      case 'update': {
        if (!id) {
          return { content: [{ type: 'text' as const, text: 'Missing required: id' }], isError: true };
        }
        const task = getTask(id, storageOptions);
        if (!task) {
          return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
        }
        const updates = { title, description, status: set_status, blocked_reason, evidence };
        const updated: Task = {
          ...task,
          ...Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined)),
          updated_at: new Date().toISOString(),
        };
        saveTask(updated, storageOptions);
        return { content: [{ type: 'text' as const, text: `Updated ${id}` }] };
      }
    }
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
