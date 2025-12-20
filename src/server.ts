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

// Storage options (can be configured via environment)
const storageOptions: StorageOptions = {
  dataDir: process.env.BACKLOG_DATA_DIR ?? 'data',
};

// ============================================================================
// Tools
// ============================================================================

// --- List Tasks ---
server.tool(
  'backlog_list',
  'List all tasks, optionally filtered by status',
  {
    status: z.array(z.enum(STATUSES)).optional().describe('Filter by status(es)'),
  },
  async ({ status }) => {
    const tasks = listTasks(status ? { status } : undefined, storageOptions);
    const summary = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      updated_at: t.updated_at,
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }],
    };
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
      .object({
        checklist: z.array(z.string()).describe('Definition of Done checklist items'),
      })
      .optional()
      .describe('Definition of Done'),
  },
  async ({ title, description, dod }) => {
    const input = { title, description, dod };

    const validation = validateCreateTaskInput(input);
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Validation failed:\n${validation.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    const backlog = loadBacklog(storageOptions);
    const task = createTask(input, backlog.tasks);

    addTask(task, storageOptions);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Created task ${task.id}: ${task.title}`,
        },
      ],
    };
  }
);

// --- Update Task ---
server.tool(
  'backlog_update',
  'Update task fields (title, description, dod). Respects mutation authority based on status.',
  {
    id: z.string().describe('Task ID'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    dod: z
      .object({
        checklist: z.array(z.string()),
      })
      .optional()
      .describe('New Definition of Done'),
  },
  async ({ id, title, description, dod }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = updateTask(task, { title, description, dod });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Update failed:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Updated task ${id}` }],
    };
  }
);

// --- Start Work ---
server.tool(
  'backlog_start',
  'Start work on a task (open → in_progress)',
  {
    id: z.string().describe('Task ID'),
  },
  async ({ id }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = transition(task, { to: 'in_progress' });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot start:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Started work on ${id}` }],
    };
  }
);

// --- Block Task ---
server.tool(
  'backlog_block',
  'Mark a task as blocked (in_progress → blocked)',
  {
    id: z.string().describe('Task ID'),
    reason: z.string().describe('Why the task is blocked'),
    dependency: z.string().optional().describe('What the task depends on'),
  },
  async ({ id, reason, dependency }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = transition(task, {
      to: 'blocked',
      blocked: { reason, dependency },
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot block:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Blocked ${id}: ${reason}` }],
    };
  }
);

// --- Unblock Task ---
server.tool(
  'backlog_unblock',
  'Unblock a task (blocked → in_progress)',
  {
    id: z.string().describe('Task ID'),
  },
  async ({ id }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = transition(task, { to: 'in_progress' });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot unblock:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Unblocked ${id}` }],
    };
  }
);

// --- Submit for Verification ---
server.tool(
  'backlog_submit',
  'Submit work for verification (in_progress → verifying). Requires DoD and evidence.',
  {
    id: z.string().describe('Task ID'),
    dod: z
      .object({
        checklist: z.array(z.string()).describe('Completed DoD items'),
      })
      .describe('Definition of Done'),
    evidence: z
      .object({
        artifacts: z.array(z.string()).describe('Proof of completion (paths, URLs, SHAs)'),
        commands: z.array(z.string()).optional().describe('Commands that were run'),
        notes: z.string().optional().describe('Additional notes'),
      })
      .describe('Evidence of completion'),
  },
  async ({ id, dod, evidence }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = transition(task, { to: 'verifying', dod, evidence });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot submit:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Submitted ${id} for verification` }],
    };
  }
);

// --- Verify (Complete) ---
server.tool(
  'backlog_verify',
  'Verify and complete a task (verifying → done)',
  {
    id: z.string().describe('Task ID'),
  },
  async ({ id }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = transition(task, { to: 'done' });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot verify:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Verified and completed ${id}` }],
    };
  }
);

// --- Reject (Back to In Progress) ---
server.tool(
  'backlog_reject',
  'Reject verification and return to in_progress (verifying → in_progress). Clears evidence.',
  {
    id: z.string().describe('Task ID'),
  },
  async ({ id }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    if (task.status !== 'verifying') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Task '${id}' is not in verifying status (current: ${task.status})`,
          },
        ],
        isError: true,
      };
    }

    const result = transition(task, { to: 'in_progress' });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot reject:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Rejected ${id}, returned to in_progress` }],
    };
  }
);

// --- Cancel Task ---
server.tool(
  'backlog_cancel',
  'Cancel a task (any non-terminal → cancelled)',
  {
    id: z.string().describe('Task ID'),
  },
  async ({ id }) => {
    const task = getTask(id, storageOptions);

    if (!task) {
      return {
        content: [{ type: 'text' as const, text: `Task '${id}' not found` }],
        isError: true,
      };
    }

    const result = transition(task, { to: 'cancelled' });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot cancel:\n${result.errors.map((e) => `- ${e.field}: ${e.message}`).join('\n')}`,
          },
        ],
        isError: true,
      };
    }

    saveTask(result.task, storageOptions);

    return {
      content: [{ type: 'text' as const, text: `Cancelled ${id}` }],
    };
  }
);

// --- Summary ---
server.tool(
  'backlog_summary',
  'Get a summary of the backlog (counts by status)',
  {},
  async () => {
    const counts = getTaskCounts(storageOptions);
    const tasks = listTasks(undefined, storageOptions);

    const blocked = tasks.filter((t) => t.status === 'blocked');
    const verifying = tasks.filter((t) => t.status === 'verifying');

    let text = `## Backlog Summary\n\n`;
    text += `| Status | Count |\n|--------|-------|\n`;
    for (const status of STATUSES) {
      text += `| ${status} | ${counts[status]} |\n`;
    }
    text += `\n**Total:** ${tasks.length}\n`;

    if (blocked.length > 0) {
      text += `\n### Blocked Tasks\n`;
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

    return {
      content: [{ type: 'text' as const, text }],
    };
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
