import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Task, Status } from './schema.js';
import { STATUSES } from './schema.js';

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
const TASKS_DIR = 'tasks';
const ARCHIVE_DIR = 'archive';

const TERMINAL_STATUSES = ['done', 'cancelled'] as const;

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getTasksPath(dataDir: string): string {
  return join(dataDir, TASKS_DIR);
}

function getArchivePath(dataDir: string): string {
  return join(dataDir, ARCHIVE_DIR);
}

function getTaskFilePath(dataDir: string, taskId: string, archived: boolean = false): string {
  const dir = archived ? getArchivePath(dataDir) : getTasksPath(dataDir);
  return join(dir, `${taskId}.md`);
}

function taskToMarkdown(task: Task): string {
  const { description, ...frontmatter } = task;
  return matter.stringify(description || '', frontmatter);
}

function markdownToTask(content: string): Task {
  const { data, content: description } = matter(content);
  
  // Validate required fields
  if (!data.id || typeof data.id !== 'string') {
    throw new Error('Invalid task: missing or invalid id');
  }
  if (!data.title || typeof data.title !== 'string') {
    throw new Error('Invalid task: missing or invalid title');
  }
  if (!data.status || typeof data.status !== 'string') {
    throw new Error('Invalid task: missing or invalid status');
  }
  if (!STATUSES.includes(data.status as Status)) {
    throw new Error(`Invalid task: status must be one of ${STATUSES.join(', ')}`);
  }
  if (!data.created_at || typeof data.created_at !== 'string') {
    throw new Error('Invalid task: missing or invalid created_at');
  }
  if (!data.updated_at || typeof data.updated_at !== 'string') {
    throw new Error('Invalid task: missing or invalid updated_at');
  }
  
  // Validate optional fields
  if (data.blocked_reason !== undefined && typeof data.blocked_reason !== 'string') {
    throw new Error('Invalid task: blocked_reason must be a string');
  }
  if (data.evidence !== undefined && !Array.isArray(data.evidence)) {
    throw new Error('Invalid task: evidence must be an array');
  }
  
  return {
    ...data,
    description: description.trim() || undefined,
  } as Task;
}

function readTaskFile(filePath: string): Task | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return markdownToTask(content);
  } catch (error) {
    console.error(`Failed to read task file ${filePath}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

function writeTaskFile(filePath: string, task: Task): void {
  const content = taskToMarkdown(task);
  writeFileSync(filePath, content, 'utf-8');
}

function listTaskFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => join(dir, f));
}

/**
 * Read raw markdown content from task file.
 */
function readTaskMarkdown(dataDir: string, taskId: string): string | null {
  const activePath = getTaskFilePath(dataDir, taskId, false);
  if (existsSync(activePath)) {
    return readFileSync(activePath, 'utf-8');
  }
  
  const archivePath = getTaskFilePath(dataDir, taskId, true);
  if (existsSync(archivePath)) {
    return readFileSync(archivePath, 'utf-8');
  }
  
  return null;
}

/**
 * Load backlog from disk. Returns empty backlog if directory doesn't exist.
 */
export function loadBacklog(options: StorageOptions = {}): Backlog {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const tasksDir = getTasksPath(dataDir);
  
  const taskFiles = listTaskFiles(tasksDir);
  const tasks = taskFiles
    .map(f => readTaskFile(f))
    .filter((t): t is Task => t !== null);

  return {
    version: '1',
    tasks,
  };
}

/**
 * Save backlog to disk (no-op for file-based storage, kept for compatibility).
 */
export function saveBacklog(backlog: Backlog, options: StorageOptions = {}): void {
  // No-op: tasks are saved individually
}

/**
 * Load archive from disk. Returns empty backlog if directory doesn't exist.
 */
export function loadArchive(options: StorageOptions = {}): Backlog {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const archiveDir = getArchivePath(dataDir);
  
  const taskFiles = listTaskFiles(archiveDir);
  const tasks = taskFiles
    .map(f => readTaskFile(f))
    .filter((t): t is Task => t !== null);

  return {
    version: '1',
    tasks,
  };
}

/**
 * Move a task from backlog to archive.
 */
function archiveTask(task: Task, options: StorageOptions = {}): void {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  ensureDir(getTasksPath(dataDir));
  ensureDir(getArchivePath(dataDir));

  const activePath = getTaskFilePath(dataDir, task.id, false);
  const archivePath = getTaskFilePath(dataDir, task.id, true);

  // Remove from active if exists
  if (existsSync(activePath)) {
    unlinkSync(activePath);
  }

  // Write to archive
  writeTaskFile(archivePath, task);
}

// ============================================================================
// Task Operations
// ============================================================================

/**
 * Get a task by ID. Returns undefined if not found.
 * Searches both active and archived tasks.
 */
export function getTask(id: string, options: StorageOptions = {}): Task | undefined {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  
  // Try active first
  const activePath = getTaskFilePath(dataDir, id, false);
  const activeTask = readTaskFile(activePath);
  if (activeTask) return activeTask;
  
  // Try archive
  const archivePath = getTaskFilePath(dataDir, id, true);
  return readTaskFile(archivePath) ?? undefined;
}

/**
 * List all tasks. Optionally filter by status.
 * If status includes 'done' or 'cancelled', includes archived tasks (limited to most recent).
 */
export function listTasks(
  filter?: { status?: Task['status'][]; archivedLimit?: number },
  options: StorageOptions = {}
): Task[] {
  const backlog = loadBacklog(options);
  let tasks = [...backlog.tasks];

  // Check if we need archived tasks (when filtering for done/cancelled)
  const needsArchive = filter?.status?.some(s => s === 'done' || s === 'cancelled');
  
  if (needsArchive) {
    const archive = loadArchive(options);
    // Sort archived by updated_at descending (most recent first)
    const sortedArchive = [...archive.tasks].sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    
    // Apply limit to archived tasks (default 10)
    const archiveLimit = filter?.archivedLimit ?? 10;
    const limitedArchive = sortedArchive.slice(0, archiveLimit);
    
    tasks = [...tasks, ...limitedArchive];
  }

  // Filter by status if specified
  if (filter?.status && filter.status.length > 0) {
    tasks = tasks.filter((t) => filter.status!.includes(t.status));
  }

  return tasks;
}

/**
 * Add a new task. Throws if task with same ID already exists in active or archive.
 */
export function addTask(task: Task, options: StorageOptions = {}): void {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  ensureDir(getTasksPath(dataDir));

  const activePath = getTaskFilePath(dataDir, task.id, false);
  const archivePath = getTaskFilePath(dataDir, task.id, true);

  if (existsSync(activePath) || existsSync(archivePath)) {
    throw new Error(`Task with ID '${task.id}' already exists`);
  }

  writeTaskFile(activePath, task);
}

/**
 * Update an existing task. Throws if task doesn't exist.
 * Automatically archives tasks with terminal status (done, cancelled).
 */
export function saveTask(task: Task, options: StorageOptions = {}): void {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const activePath = getTaskFilePath(dataDir, task.id, false);
  const archivePath = getTaskFilePath(dataDir, task.id, true);

  if (!existsSync(activePath) && !existsSync(archivePath)) {
    throw new Error(`Task with ID '${task.id}' not found`);
  }

  // Archive if terminal status
  if (TERMINAL_STATUSES.includes(task.status as typeof TERMINAL_STATUSES[number])) {
    archiveTask(task, options);
    return;
  }

  ensureDir(getTasksPath(dataDir));
  writeTaskFile(activePath, task);
}

/**
 * Delete a task by ID. Throws if task doesn't exist.
 */
export function deleteTask(id: string, options: StorageOptions = {}): void {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const activePath = getTaskFilePath(dataDir, id, false);
  const archivePath = getTaskFilePath(dataDir, id, true);

  if (existsSync(activePath)) {
    unlinkSync(activePath);
  } else if (existsSync(archivePath)) {
    unlinkSync(archivePath);
  } else {
    throw new Error(`Task with ID '${id}' not found`);
  }
}

/**
 * Check if a task exists.
 */
export function taskExists(id: string, options: StorageOptions = {}): boolean {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const activePath = getTaskFilePath(dataDir, id, false);
  const archivePath = getTaskFilePath(dataDir, id, true);
  return existsSync(activePath) || existsSync(archivePath);
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

/**
 * Get raw markdown content for a task by ID.
 */
export function getTaskMarkdown(id: string, options: StorageOptions = {}): string | null {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  return readTaskMarkdown(dataDir, id);
}
