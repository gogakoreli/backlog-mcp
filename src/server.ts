#!/usr/bin/env node

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createTask, STATUSES, type Task } from './schema.js';
import { storage } from './backlog.js';
import { startViewer } from './viewer.js';

// Init storage
const dataDir = process.env.BACKLOG_DATA_DIR ?? 'data';
storage.init(dataDir);

// ============================================================================
// Server
// ============================================================================

const server = new McpServer({
  name: 'backlog-mcp',
  version: '0.1.0',
});

// ============================================================================
// Tools
// ============================================================================

const ACTIONS = ['list', 'get', 'create', 'update', 'delete'] as const;

server.registerTool(
  'backlog',
  {
    description: `Local task backlog. Actions:
- list: Show tasks (active by default, add status=["done"] for completed)
- get: Fetch task by ID (works for ANY status - active or archived)
- create: New task
- update: Modify task
- delete: Permanently remove task`,
    inputSchema: {
      action: z.enum(ACTIONS).describe('Action to perform'),
      // list options
      status: z.array(z.enum(STATUSES)).optional().describe('Filter by status (list only). Default: active tasks'),
      summary: z.boolean().optional().describe('Return counts instead of list (list)'),
      archived_limit: z.number().optional().describe('Max archived tasks to return (list). Default: 10'),
      // get/update/delete options
      id: z.string().optional().describe('Task ID like TASK-0001 (get, update, delete). Get works on any task regardless of status'),
      ids: z.array(z.string()).optional().describe('Multiple task IDs (get only). Returns all in one call'),
      // create/update options
      title: z.string().optional().describe('Task title (create, update)'),
      description: z.string().optional().describe('Task description in markdown (create, update)'),
      // update-only options
      set_status: z.enum(STATUSES).optional().describe('New status (update)'),
      blocked_reason: z.string().optional().describe('Reason for blocked status (update)'),
      evidence: z.array(z.string()).optional().describe('Evidence of completion - links, notes (update)'),
    },
  },
  async ({ action, status, summary, archived_limit, id, ids, title, description, set_status, blocked_reason, evidence }) => {
    switch (action) {
      case 'list': {
        const filter = status || archived_limit ? { status, archivedLimit: archived_limit } : undefined;
        const tasks = storage.list(filter);
        if (summary) {
          const counts = storage.counts();
          return { content: [{ type: 'text' as const, text: JSON.stringify(counts, null, 2) }] };
        }
        const list = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
      }

      case 'get': {
        const taskIds = ids || (id ? [id] : []);
        if (taskIds.length === 0) {
          return { content: [{ type: 'text' as const, text: 'Missing required: id or ids' }], isError: true };
        }
        const results = taskIds.map(tid => {
          const markdown = storage.getMarkdown(tid);
          return markdown || `Not found: ${tid}`;
        });
        return { content: [{ type: 'text' as const, text: results.join('\n\n---\n\n') }] };
      }

      case 'create': {
        if (!title) {
          return { content: [{ type: 'text' as const, text: 'Missing required: title' }], isError: true };
        }
        const existing = storage.list();
        const task = createTask({ title, description }, existing);
        storage.add(task);
        return { content: [{ type: 'text' as const, text: `Created ${task.id}` }] };
      }

      case 'update': {
        if (!id) {
          return { content: [{ type: 'text' as const, text: 'Missing required: id' }], isError: true };
        }
        const task = storage.get(id);
        if (!task) {
          return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
        }
        const updates = { title, description, status: set_status, blocked_reason, evidence };
        const updated: Task = {
          ...task,
          ...Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined)),
          updated_at: new Date().toISOString(),
        };
        storage.save(updated);
        return { content: [{ type: 'text' as const, text: `Updated ${id}` }] };
      }

      case 'delete': {
        if (!id) {
          return { content: [{ type: 'text' as const, text: 'Missing required: id' }], isError: true };
        }
        const deleted = storage.delete(id);
        if (!deleted) {
          return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Deleted ${id}` }] };
      }
    }
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
