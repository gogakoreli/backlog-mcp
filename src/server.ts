#!/usr/bin/env node

try { await import('dotenv/config'); } catch {}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { nextTaskId } from './schema.js';

import { createTask, STATUSES, TASK_TYPES, type Task } from './schema.js';
import { storage } from './backlog.js';
import { startViewer } from './viewer.js';
import { writeResource } from './resources/index.js';

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
    inputSchema: z.object({
      status: z.array(z.enum(STATUSES)).optional().describe('Filter: open, in_progress, blocked, done, cancelled. Default: open, in_progress, blocked'),
      type: z.enum(TASK_TYPES).optional().describe('Filter by type: task, epic, or omit for all'),
      epic_id: z.string().optional().describe('Filter tasks belonging to a specific epic'),
      counts: z.boolean().optional().describe('Return counts per status instead of task list'),
      limit: z.number().optional().describe('Max tasks to return. Default: 20'),
    }),
  },
  async ({ status, type, epic_id, counts, limit }) => {
    let tasks = storage.list({ status, limit });
    if (type) tasks = tasks.filter(t => (t.type ?? 'task') === type);
    if (epic_id) tasks = tasks.filter(t => t.epic_id === epic_id);
    if (counts) {
      return { content: [{ type: 'text' as const, text: JSON.stringify(storage.counts(), null, 2) }] };
    }
    const list = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, type: t.type ?? 'task', epic_id: t.epic_id }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  }
);

server.registerTool(
  'backlog_get',
  {
    description: 'Get full task details by ID. Works for any task regardless of status.',
    inputSchema: z.object({
      id: z.union([z.string(), z.array(z.string())]).describe('Task ID like TASK-0001, or array for batch fetch'),
    }),
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
    inputSchema: z.object({
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description in markdown'),
      type: z.enum(TASK_TYPES).optional().describe('Type: task (default) or epic'),
      epic_id: z.string().optional().describe('Parent epic ID to link this task to'),
      references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links with optional titles'),
    }),
  },
  async ({ title, description, type, epic_id, references }) => {
    const id = nextTaskId(storage.getMaxId(type), type);
    const task = createTask({ id, title, description, type, epic_id, references });
    storage.add(task);
    return { content: [{ type: 'text' as const, text: `Created ${task.id}` }] };
  }
);

server.registerTool(
  'backlog_update',
  {
    description: 'Update an existing task.',
    inputSchema: z.object({
      id: z.string().describe('Task ID to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(STATUSES).optional().describe('New status'),
      epic_id: z.string().nullable().optional().describe('Parent epic ID (null to unlink)'),
      references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Reference links with optional titles'),
      blocked_reason: z.array(z.string()).optional().describe('Reason if status is blocked'),
      evidence: z.array(z.string()).optional().describe('Proof of completion when marking done - links to PRs, docs, or notes'),
    }),
  },
  async ({ id, title, description, status, epic_id, references, blocked_reason, evidence }) => {
    const task = storage.get(id);
    if (!task) {
      return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
    }
    const updates: Partial<Task> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (epic_id !== undefined) updates.epic_id = epic_id ?? undefined;
    if (references !== undefined) updates.references = references;
    if (blocked_reason !== undefined) updates.blocked_reason = blocked_reason;
    if (evidence !== undefined) updates.evidence = evidence;
    const updated: Task = { ...task, ...updates, updated_at: new Date().toISOString() };
    storage.save(updated);
    return { content: [{ type: 'text' as const, text: `Updated ${id}` }] };
  }
);

server.registerTool(
  'backlog_delete',
  {
    description: 'Permanently delete a task from the backlog.',
    inputSchema: z.object({
      id: z.string().describe('Task ID to delete'),
    }),
  },
  async ({ id }) => {
    const deleted = storage.delete(id);
    if (!deleted) {
      return { content: [{ type: 'text' as const, text: `Not found: ${id}` }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: `Deleted ${id}` }] };
  }
);

server.registerTool(
  'write_resource',
  {
    description: 'Write to MCP resources using fs_write-style operations. Similar to @builtin/fs_write but for mcp:// URIs.',
    inputSchema: z.object({
      uri: z.string().describe('Resource URI (e.g., mcp://backlog/tasks/TASK-0039/description)'),
      command: z.enum(['strReplace', 'insert']).describe('Operation: strReplace or insert'),
      oldStr: z.string().optional().describe('For strReplace: string to find'),
      newStr: z.string().optional().describe('For strReplace: replacement string'),
      content: z.string().optional().describe('For insert: content to add'),
      insertLine: z.number().optional().describe('For insert: line number (0-based). Omit to append.'),
    }),
  },
  async ({ uri, command, oldStr, newStr, content, insertLine }) => {
    let operation;
    if (command === 'strReplace') {
      operation = { type: 'str_replace', old_str: oldStr!, new_str: newStr! };
    } else if (command === 'insert') {
      if (insertLine !== undefined) {
        operation = { type: 'insert', line: insertLine, content: content || newStr || '' };
      } else {
        operation = { type: 'append', content: content || newStr || '' };
      }
    }
    
    const result = writeResource(
      { uri, operation: operation as any },
      (taskId) => storage.getFilePath(taskId)
    );
    
    if (!result.success) {
      return { 
        content: [{ type: 'text' as const, text: `${result.message}\n${result.error || ''}` }], 
        isError: true 
      };
    }
    
    return { content: [{ type: 'text' as const, text: result.message }] };
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
