export const API_URL = 'http://localhost:3030';

export interface Reference {
  url: string;
  title?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  type?: 'task' | 'epic';
  epic_id?: string;
  references?: Reference[];
  blocked_reason?: string[];
  evidence?: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskResponse extends Task {
  filePath?: string;
  raw?: string;
  epicTitle?: string;
}

export async function fetchTasks(filter: 'active' | 'completed' | 'all' = 'active'): Promise<Task[]> {
  const url = `${API_URL}/tasks?filter=${filter}`;
  const response = await fetch(url);
  return response.json();
}

export async function fetchTask(taskId: string): Promise<TaskResponse> {
  const response = await fetch(`${API_URL}/tasks/${taskId}`);
  return response.json();
}
