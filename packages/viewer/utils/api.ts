// API URL dynamically uses the current page's port (works for both dev:3031 and prod:3030)
export const API_URL = `http://localhost:${window.location.port || 3030}`;

export interface Reference {
  url: string;
  title?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  type?: string;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
  blocked_reason?: string[];
  evidence?: string[];
  created_at: string;
  updated_at: string;
  due_date?: string;
  content_type?: string;
  path?: string;
}

export interface TaskResponse extends Task {
  filePath?: string;
  raw?: string;
  epicTitle?: string;
  parentTitle?: string;
  children?: Task[];
}

export async function fetchTasks(filter: 'active' | 'completed' | 'all' = 'active', query?: string): Promise<Task[]> {
  let url = `${API_URL}/tasks?filter=${filter}`;
  if (query) url += `&q=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  return response.json();
}

export async function fetchTask(taskId: string): Promise<TaskResponse> {
  const response = await fetch(`${API_URL}/tasks/${taskId}`);
  return response.json();
}

export async function fetchOperationCount(taskId: string): Promise<number> {
  const response = await fetch(`${API_URL}/operations/count/${encodeURIComponent(taskId)}`);
  const data = await response.json();
  return data.count || 0;
}
