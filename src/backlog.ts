import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Task, Status } from './schema.js';

const TASKS_DIR = 'tasks';
const ARCHIVE_DIR = 'archive';
const TERMINAL_STATUSES: Status[] = ['done', 'cancelled'];

class BacklogStorage {
  private dataDir: string = 'data';
  private static instance: BacklogStorage;

  static getInstance(): BacklogStorage {
    if (!BacklogStorage.instance) {
      BacklogStorage.instance = new BacklogStorage();
    }
    return BacklogStorage.instance;
  }

  init(dataDir: string): void {
    this.dataDir = dataDir;
  }

  private get tasksPath(): string {
    return join(this.dataDir, TASKS_DIR);
  }

  private get archivePath(): string {
    return join(this.dataDir, ARCHIVE_DIR);
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private taskFilePath(id: string, archived: boolean = false): string {
    return join(archived ? this.archivePath : this.tasksPath, `${id}.md`);
  }

  private taskToMarkdown(task: Task): string {
    const { description, ...frontmatter } = task;
    return matter.stringify(description || '', frontmatter);
  }

  private markdownToTask(content: string): Task {
    const { data, content: description } = matter(content);
    return { ...data, description: description.trim() } as Task;
  }

  getFilePath(id: string): string | null {
    const activePath = this.taskFilePath(id, false);
    if (existsSync(activePath)) return activePath;
    const archivePath = this.taskFilePath(id, true);
    if (existsSync(archivePath)) return archivePath;
    return null;
  }

  get(id: string): Task | undefined {
    const activePath = this.taskFilePath(id, false);
    if (existsSync(activePath)) {
      return this.markdownToTask(readFileSync(activePath, 'utf-8'));
    }
    const archivePath = this.taskFilePath(id, true);
    if (existsSync(archivePath)) {
      return this.markdownToTask(readFileSync(archivePath, 'utf-8'));
    }
    return undefined;
  }

  getMarkdown(id: string): string | null {
    const activePath = this.taskFilePath(id, false);
    if (existsSync(activePath)) {
      return readFileSync(activePath, 'utf-8');
    }
    const archivePath = this.taskFilePath(id, true);
    if (existsSync(archivePath)) {
      return readFileSync(archivePath, 'utf-8');
    }
    return null;
  }

  list(filter?: { status?: Status[]; archivedLimit?: number }): Task[] {
    const tasks: Task[] = [];
    const statusFilter = filter?.status;
    const archivedLimit = filter?.archivedLimit ?? 10;

    // Load active tasks
    if (existsSync(this.tasksPath)) {
      const files = readdirSync(this.tasksPath).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const task = this.markdownToTask(readFileSync(join(this.tasksPath, file), 'utf-8'));
        if (!statusFilter || statusFilter.includes(task.status)) {
          tasks.push(task);
        }
      }
    }

    // Load archived tasks if needed
    const needsArchived = !statusFilter || statusFilter.some(s => TERMINAL_STATUSES.includes(s));
    if (needsArchived && existsSync(this.archivePath)) {
      const files = readdirSync(this.archivePath).filter(f => f.endsWith('.md'));
      const archived = files
        .map(file => this.markdownToTask(readFileSync(join(this.archivePath, file), 'utf-8')))
        .filter(t => !statusFilter || statusFilter.includes(t.status))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, archivedLimit);
      tasks.push(...archived);
    }

    return tasks;
  }

  add(task: Task): void {
    this.ensureDir(this.tasksPath);
    const filePath = this.taskFilePath(task.id, false);
    writeFileSync(filePath, this.taskToMarkdown(task));
  }

  save(task: Task): void {
    const isTerminal = TERMINAL_STATUSES.includes(task.status);
    const activePath = this.taskFilePath(task.id, false);
    const archivePath = this.taskFilePath(task.id, true);

    // Move to archive if terminal status
    if (isTerminal) {
      this.ensureDir(this.archivePath);
      writeFileSync(archivePath, this.taskToMarkdown(task));
      if (existsSync(activePath)) unlinkSync(activePath);
    } else {
      this.ensureDir(this.tasksPath);
      writeFileSync(activePath, this.taskToMarkdown(task));
      if (existsSync(archivePath)) unlinkSync(archivePath);
    }
  }

  delete(id: string): boolean {
    const activePath = this.taskFilePath(id, false);
    if (existsSync(activePath)) {
      unlinkSync(activePath);
      return true;
    }
    const archivePath = this.taskFilePath(id, true);
    if (existsSync(archivePath)) {
      unlinkSync(archivePath);
      return true;
    }
    return false;
  }

  counts(): Record<Status, number> {
    const counts: Record<Status, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };

    if (existsSync(this.tasksPath)) {
      for (const file of readdirSync(this.tasksPath).filter(f => f.endsWith('.md'))) {
        const task = this.markdownToTask(readFileSync(join(this.tasksPath, file), 'utf-8'));
        counts[task.status]++;
      }
    }

    if (existsSync(this.archivePath)) {
      for (const file of readdirSync(this.archivePath).filter(f => f.endsWith('.md'))) {
        const task = this.markdownToTask(readFileSync(join(this.archivePath, file), 'utf-8'));
        counts[task.status]++;
      }
    }

    return counts;
  }
}

export const storage = BacklogStorage.getInstance();
