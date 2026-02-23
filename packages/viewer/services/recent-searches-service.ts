const STORAGE_KEY = 'backlog:recent-searches';
const MAX_ITEMS = 15;

export interface RecentSearchItem {
  id: string;
  title: string;
  type: 'task' | 'epic' | 'resource';
  timestamp: number;
}

class RecentSearchesService {
  private items: RecentSearchItem[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.items = JSON.parse(stored);
      }
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
  }

  add(item: Omit<RecentSearchItem, 'timestamp'>): void {
    // Remove existing entry with same ID
    this.items = this.items.filter(i => i.id !== item.id);
    // Add to front with current timestamp
    this.items.unshift({ ...item, timestamp: Date.now() });
    // Limit to MAX_ITEMS
    if (this.items.length > MAX_ITEMS) {
      this.items = this.items.slice(0, MAX_ITEMS);
    }
    this.save();
  }

  getAll(): RecentSearchItem[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
    this.save();
  }
}

export const recentSearchesService = new RecentSearchesService();
