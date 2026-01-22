import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Task, Status } from './schema.js';

const TASKS_DIR = 'tasks';

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

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private taskFilePath(id: string): string {
    return join(this.tasksPath, `${id}.md`);
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
    const path = this.taskFilePath(id);
    return existsSync(path) ? path : null;
  }

  private *iterateTasks(): Generator<Task> {
    if (existsSync(this.tasksPath)) {
      for (const file of readdirSync(this.tasksPath).filter(f => f.endsWith('.md'))) {
        yield this.markdownToTask(readFileSync(join(this.tasksPath, file), 'utf-8'));
      }
    }
  }

  get(id: string): Task | undefined {
    const path = this.taskFilePath(id);
    if (existsSync(path)) {
      return this.markdownToTask(readFileSync(path, 'utf-8'));
    }
    return undefined;
  }

  getMarkdown(id: string): string | null {
    const path = this.taskFilePath(id);
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    return null;
  }

  list(filter?: { status?: Status[]; limit?: number }): Task[] {
    const statusFilter = filter?.status;
    const limit = filter?.limit ?? 20;

    const tasks = Array.from(this.iterateTasks())
      .filter(t => !statusFilter || statusFilter.includes(t.status));

    return tasks
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  }

  add(task: Task): void {
    this.ensureDir(this.tasksPath);
    const filePath = this.taskFilePath(task.id);
    writeFileSync(filePath, this.taskToMarkdown(task));
  }

  save(task: Task): void {
    this.ensureDir(this.tasksPath);
    const filePath = this.taskFilePath(task.id);
    writeFileSync(filePath, this.taskToMarkdown(task));
  }

  delete(id: string): boolean {
    const path = this.taskFilePath(id);
    if (existsSync(path)) {
      unlinkSync(path);
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

    for (const task of this.iterateTasks()) {
      counts[task.status]++;
    }

    return counts;
  }

  getAllIds(): string[] {
    if (!existsSync(this.tasksPath)) return [];
    return readdirSync(this.tasksPath)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
  }

  getMaxId(type?: 'task' | 'epic'): number {
    const pattern = type === 'epic' ? /^EPIC-(\d{4,})\.md$/ : /^TASK-(\d{4,})\.md$/;
    let maxNum = 0;

    if (existsSync(this.tasksPath)) {
      for (const file of readdirSync(this.tasksPath)) {
        const match = pattern.exec(file);
        if (match?.[1]) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }

    return maxNum;
  }
}

export const storage = BacklogStorage.getInstance();
