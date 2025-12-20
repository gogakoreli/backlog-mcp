import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task } from './schema.js';

// ============================================================================
// Types
// ============================================================================

export interface Backlog {
  version: '1';
  tasks: Task[];
}

export interface StorageOptions {
  dataDir?: string;
}

// ============================================================================
// Storage
// ============================================================================

const DEFAULT_DATA_DIR = 'data';
const BACKLOG_FILE = 'backlog.json';

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getBacklogPath(dataDir: string): string {
  return join(dataDir, BACKLOG_FILE);
}

function emptyBacklog(): Backlog {
  return {
    version: '1',
    tasks: [],
  };
}

/**
 * Load backlog from disk. Returns empty backlog if file doesn't exist.
 */
export function loadBacklog(options: StorageOptions = {}): Backlog {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const path = getBacklogPath(dataDir);

  if (!existsSync(path)) {
    return emptyBacklog();
  }

  const content = readFileSync(path, 'utf-8');
  const data = JSON.parse(content) as Backlog;

  // Basic version check
  if (data.version !== '1') {
    throw new Error(`Unsupported backlog version: ${data.version}`);
  }

  return data;
}

/**
 * Save backlog to disk atomically (write to temp, then rename).
 */
export function saveBacklog(backlog: Backlog, options: StorageOptions = {}): void {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  ensureDir(dataDir);

  const path = getBacklogPath(dataDir);
  const tempPath = join(dataDir, `.backlog.${randomUUID()}.tmp`);

  const content = JSON.stringify(backlog, null, 2);

  // Write to temp file first
  writeFileSync(tempPath, content, 'utf-8');

  // Atomic rename
  renameSync(tempPath, path);
}

// ============================================================================
// Task Operations
// ============================================================================

/**
 * Get a task by ID. Returns undefined if not found.
 */
export function getTask(id: string, options: StorageOptions = {}): Task | undefined {
  const backlog = loadBacklog(options);
  return backlog.tasks.find((t) => t.id === id);
}

/**
 * List all tasks. Optionally filter by status.
 */
export function listTasks(
  filter?: { status?: Task['status'][] },
  options: StorageOptions = {}
): Task[] {
  const backlog = loadBacklog(options);

  if (filter?.status && filter.status.length > 0) {
    return backlog.tasks.filter((t) => filter.status!.includes(t.status));
  }

  return backlog.tasks;
}

/**
 * Add a new task. Throws if task with same ID already exists.
 */
export function addTask(task: Task, options: StorageOptions = {}): void {
  const backlog = loadBacklog(options);

  if (backlog.tasks.some((t) => t.id === task.id)) {
    throw new Error(`Task with ID '${task.id}' already exists`);
  }

  backlog.tasks.push(task);
  saveBacklog(backlog, options);
}

/**
 * Update an existing task. Throws if task doesn't exist.
 */
export function saveTask(task: Task, options: StorageOptions = {}): void {
  const backlog = loadBacklog(options);
  const index = backlog.tasks.findIndex((t) => t.id === task.id);

  if (index === -1) {
    throw new Error(`Task with ID '${task.id}' not found`);
  }

  backlog.tasks[index] = task;
  saveBacklog(backlog, options);
}

/**
 * Delete a task by ID. Throws if task doesn't exist.
 */
export function deleteTask(id: string, options: StorageOptions = {}): void {
  const backlog = loadBacklog(options);
  const index = backlog.tasks.findIndex((t) => t.id === id);

  if (index === -1) {
    throw new Error(`Task with ID '${id}' not found`);
  }

  backlog.tasks.splice(index, 1);
  saveBacklog(backlog, options);
}

/**
 * Check if a task exists.
 */
export function taskExists(id: string, options: StorageOptions = {}): boolean {
  const backlog = loadBacklog(options);
  return backlog.tasks.some((t) => t.id === id);
}

/**
 * Get count of tasks by status.
 */
export function getTaskCounts(options: StorageOptions = {}): Record<Task['status'], number> {
  const backlog = loadBacklog(options);
  const counts: Record<Task['status'], number> = {
    open: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  };

  for (const task of backlog.tasks) {
    counts[task.status]++;
  }

  return counts;
}
