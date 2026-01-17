export const API_URL = 'http://localhost:3030';

export interface Task {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function fetchTasks(filter: 'active' | 'completed' | 'all' = 'active'): Promise<Task[]> {
  const url = `${API_URL}/tasks?filter=${filter}`;
  const response = await fetch(url);
  return response.json();
}

export async function fetchTask(taskId: string): Promise<any> {
  const response = await fetch(`${API_URL}/tasks/${taskId}`);
  return response.json();
}
