import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Entity, Status, EntityType } from '@backlog-mcp/shared';
import { TYPE_PREFIXES, isValidEntityId } from '@backlog-mcp/shared';
import { paths } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

const TASKS_DIR = 'tasks';

/**
 * Pure file I/O for task storage. No search knowledge.
 */
export class TaskStorage {
  private get tasksPath(): string {
    return join(paths.backlogDataDir, TASKS_DIR);
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private taskFilePath(id: string): string {
    return join(this.tasksPath, `${id}.md`);
  }

  private taskToMarkdown(task: Entity): string {
    const { description, ...frontmatter } = task;
    return matter.stringify(description || '', frontmatter);
  }

  private markdownToTask(content: string): Entity {
    const { data, content: description } = matter(content);
    return { ...data, description: description.trim() } as Entity;
  }

  getFilePath(id: string): string | null {
    const path = this.taskFilePath(id);
    return existsSync(path) ? path : null;
  }

  *iterateTasks(): Generator<Entity> {
    if (existsSync(this.tasksPath)) {
      for (const file of readdirSync(this.tasksPath).filter(f => f.endsWith('.md'))) {
        const filePath = join(this.tasksPath, file);
        try {
          const task = this.markdownToTask(readFileSync(filePath, 'utf-8'));
          if (!task.id) continue;
          yield task;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn('Malformed task file', { file, error: errorMessage });
          }
          continue;
        }
      }
    }
  }

  get(id: string): Entity | undefined {
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

  list(filter?: { status?: Status[]; type?: EntityType; epic_id?: string; parent_id?: string; limit?: number }): Entity[] {
    const { status, type, epic_id, parent_id, limit = 20 } = filter ?? {};
    let tasks = Array.from(this.iterateTasks());
    
    if (status) tasks = tasks.filter(t => status.includes(t.status));
    if (type) tasks = tasks.filter(t => (t.type ?? 'task') === type);
    if (parent_id) tasks = tasks.filter(t => (t.parent_id ?? t.epic_id) === parent_id);
    else if (epic_id) tasks = tasks.filter(t => (t.parent_id ?? t.epic_id) === epic_id);
    
    return tasks
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  }

  add(task: Entity): void {
    this.ensureDir(this.tasksPath);
    writeFileSync(this.taskFilePath(task.id), this.taskToMarkdown(task));
  }

  save(task: Entity): void {
    if (!isValidEntityId(task.id)) {
      throw new Error(`Cannot save task with invalid id: ${String(task.id)}`);
    }
    this.ensureDir(this.tasksPath);
    writeFileSync(this.taskFilePath(task.id), this.taskToMarkdown(task));
  }

  delete(id: string): boolean {
    const path = this.taskFilePath(id);
    if (existsSync(path)) {
      unlinkSync(path);
      
      // Delete associated resources if they exist
      const resourcesPath = join(paths.backlogDataDir, 'resources', id);
      if (existsSync(resourcesPath)) {
        rmSync(resourcesPath, { recursive: true, force: true });
      }
      
      return true;
    }
    return false;
  }

  counts(): { total_tasks: number; total_epics: number; by_status: Record<Status, number>; by_type: Record<string, number> } {
    const by_status: Record<Status, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };

    const by_type: Record<string, number> = {};
    let total_tasks = 0;
    let total_epics = 0;

    for (const task of this.iterateTasks()) {
      by_status[task.status]++;
      const type = task.type ?? 'task';
      by_type[type] = (by_type[type] || 0) + 1;
      if (type === 'epic') {
        total_epics++;
      } else {
        total_tasks++;
      }
    }

    return { total_tasks, total_epics, by_status, by_type };
  }

  getMaxId(type?: EntityType): number {
    const prefix = TYPE_PREFIXES[type ?? 'task'];
    const pattern = new RegExp(`^${prefix}-(\\d{4,})\\.md$`);
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
