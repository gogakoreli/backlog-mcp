import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Task, Status, TaskType } from './schema.js';

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

  getDataDir(): string {
    return this.dataDir;
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
        const filePath = join(this.tasksPath, file);
        try {
          yield this.markdownToTask(readFileSync(filePath, 'utf-8'));
        } catch (error) {
          // Skip files that were deleted between listing and reading
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
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

  list(filter?: { status?: Status[]; type?: TaskType; epic_id?: string; limit?: number }): Task[] {
    const { status, type, epic_id, limit = 20 } = filter ?? {};

    let tasks = Array.from(this.iterateTasks());
    
    if (status) tasks = tasks.filter(t => status.includes(t.status));
    if (type) tasks = tasks.filter(t => (t.type ?? 'task') === type);
    if (epic_id) tasks = tasks.filter(t => t.epic_id === epic_id);

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
      
      // Delete associated resources if they exist
      const resourcesPath = join(this.dataDir, 'resources', id);
      if (existsSync(resourcesPath)) {
        rmSync(resourcesPath, { recursive: true, force: true });
      }
      
      return true;
    }
    return false;
  }

  counts(): { total_tasks: number; total_epics: number; by_status: Record<Status, number> } {
    const by_status: Record<Status, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };

    let total_tasks = 0;
    let total_epics = 0;

    for (const task of this.iterateTasks()) {
      by_status[task.status]++;
      if ((task.type ?? 'task') === 'epic') {
        total_epics++;
      } else {
        total_tasks++;
      }
    }

    return { total_tasks, total_epics, by_status };
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
