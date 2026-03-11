import type { Entity, Status, EntityType } from '@backlog-mcp/shared';

export interface ListFilter {
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  query?: string;
  limit?: number;
}

export interface IBacklogService {
  get(id: string): Promise<Entity | undefined>;
  getMarkdown(id: string): Promise<string | null>;
  list(filter?: ListFilter): Promise<Entity[]>;
  add(task: Entity): Promise<void>;
  save(task: Entity): Promise<void>;
  delete(id: string): Promise<boolean>;
  counts(): Promise<{ total_tasks: number; total_epics: number; by_status: Record<string, number>; by_type: Record<string, number> }>;
  getMaxId(type?: EntityType): Promise<number>;
  searchUnified(query: string, options?: { types?: Array<'task' | 'epic' | 'resource'>; status?: Status[]; parent_id?: string; sort?: string; limit?: number }): Promise<Array<{ item: Entity | any; score: number; type: 'task' | 'epic' | 'resource'; snippet?: any }>>;
  // Optional local-only methods
  getSync?(id: string): Entity | undefined;
  getResource?(uri: string): any;
  isHybridSearchActive?(): boolean;
  getFilePath?(id: string): string | null;
  listSync?(filter?: any): Entity[];
}
