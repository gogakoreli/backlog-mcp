#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  createTask,
  validateCreateTaskInput,
  updateTask,
  STATUSES,
} from './schema.js';

import { transition } from './transitions.js';

import {
  loadBacklog,
  getTask,
  listTasks,
  addTask,
  saveTask,
  getTaskCounts,
  type StorageOptions,
} from './storage.js';

// ============================================================================
// Server Setup
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

// --- List / Summary ---
server.tool(
  'backlog_list',
  'List tasks or get summary. Use summary=true for counts and health overview.',
  {
    status: z.array(z.enum(STATUSES)).optional().describe('Filter by status(es)'),
    summary: z.boolean().optional().describe('Return summary with counts instead of task list'),
  },
  async ({ status, summary }) => {
    const tasks = listTasks(status ? { status } : undefined, storageOptions);

    if (summary) {
      const counts = getTaskCounts(storageOptions);
      const blocked = tasks.filter((t) => t.status === 'blocked');
      const verifying = tasks.filter((t) => t.status === 'verifying');

      let text = `## Backlog Summary\n\n`;
      text += `| Status | Count |\n|--------|-------|\n`;
      for (const s of STATUSES) {
        text += `| ${s} | ${counts[s]} |\n`;
      }
      text += `\n**Total:** ${tasks.length}\n`;

      if (blocked.length > 0) {
        text += `\n### Blocked\n`;
        for (const t of blocked) {
          text += `- ${t.id}: ${t.title} (${t.blocked?.reason})\n`;
        }
      }

      if (verifying.length > 0) {
        text += `\n### Awaiting Verification\n`;
        for (const t of verifying) {
          text += `- ${t.id}: ${t.title}\n`;
        }
      }

      return { content: [{ type: 'text' as const, text }] };
    }

    const list = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      updated_at: t.updated_at,
    }));

    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  }
);

// --- Get Task ---
server.tool(
  'backlog_get',
  'Get full details of a task by ID',
  {
    id: z.string().describe('Task ID (e.g., TASK-0001)'),
  },
  async ({ id }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
  }
);

// --- Create Task ---
server.tool(
  'backlog_create',
  'Create a new task',
  {
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    dod: z
      .object({ checklist: z.array(z.string()) })
      .optional()
      .describe('Definition of Done checklist'),
  },
  async ({ title, description, dod }) => {
    const input = { title, description, dod };

    const validation = validateCreateTaskInput(input);
    if (!validation.valid) {
      return {
        content: [{ type: 'text' as const, text: `Validation failed:\n${validation.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}` }],
        isError: true,
      };
    }

    const backlog = loadBacklog(storageOptions);
    const task = createTask(input, backlog.tasks);
    addTask(task, storageOptions);

    return { content: [{ type: 'text' as const, text: `Created ${task.id}: ${task.title}` }] };
  }
);

// --- Update Task (fields or transition) ---
const ACTIONS = ['start', 'block', 'unblock', 'submit', 'verify', 'reject', 'cancel'] as const;

server.tool(
  'backlog_update',
  `Update a task. Either update fields (title, description, dod) or transition state via action.

Actions (state transitions):
- start: open → in_progress
- block: in_progress → blocked (requires reason)
- unblock: blocked → in_progress
- submit: in_progress → verifying (requires dod + evidence)
- verify: verifying → done
- reject: verifying → in_progress (clears evidence)
- cancel: any → cancelled`,
  {
    id: z.string().describe('Task ID'),
    // Field updates
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    dod: z.object({ checklist: z.array(z.string()) }).optional().describe('Definition of Done'),
    // State transition
    action: z.enum(ACTIONS).optional().describe('State transition action'),
    reason: z.string().optional().describe('Block reason (for block action)'),
    dependency: z.string().optional().describe('Dependency (for block action)'),
    evidence: z
      .object({
        artifacts: z.array(z.string()).describe('Proof of completion'),
        commands: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
      .optional()
      .describe('Evidence (for submit action)'),
  },
  async ({ id, title, description, dod, action, reason, dependency, evidence }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    // If action provided, do state transition
    if (action) {
      let transitionInput;
      switch (action) {
        case 'start':
        case 'unblock':
          transitionInput = { to: 'in_progress' as const };
          break;
        case 'block':
          if (!reason) {
            return { content: [{ type: 'text' as const, text: 'block requires reason' }], isError: true };
          }
          transitionInput = { to: 'blocked' as const, blocked: { reason, dependency } };
          break;
        case 'submit':
          if (!dod || !evidence) {
            return { content: [{ type: 'text' as const, text: 'submit requires dod and evidence' }], isError: true };
          }
          transitionInput = { to: 'verifying' as const, dod, evidence };
          break;
        case 'verify':
          transitionInput = { to: 'done' as const };
          break;
        case 'reject':
          if (task.status !== 'verifying') {
            return { content: [{ type: 'text' as const, text: `reject requires verifying status (current: ${task.status})` }], isError: true };
          }
          transitionInput = { to: 'in_progress' as const };
          break;
        case 'cancel':
          transitionInput = { to: 'cancelled' as const };
          break;
      }

      const result = transition(task, transitionInput);
      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Transition failed:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}` }],
          isError: true,
        };
      }

      saveTask(result.task, storageOptions);

      const messages: Record<typeof action, string> = {
        start: `Started ${id}`,
        block: `Blocked ${id}: ${reason}`,
        unblock: `Unblocked ${id}`,
        submit: `Submitted ${id} for verification`,
        verify: `Completed ${id}`,
        reject: `Rejected ${id}`,
        cancel: `Cancelled ${id}`,
      };
      return { content: [{ type: 'text' as const, text: messages[action] }] };
    }

    // Otherwise, field update
    const result = updateTask(task, { title, description, dod });
    if (!result.ok) {
      return {
        content: [{ type: 'text' as const, text: `Update failed:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}` }],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);
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
