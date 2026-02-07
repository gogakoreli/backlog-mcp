const STORAGE_KEY = 'backlog:sidebar-scope';

type ScopeListener = (scopeId: string | null) => void;

class SidebarScope {
  private listeners: ScopeListener[] = [];

  get(): string | null {
    return localStorage.getItem(STORAGE_KEY);
  }

  set(id: string | null) {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    document.dispatchEvent(new CustomEvent('scope-change', { detail: { scopeId: id } }));
    this.listeners.forEach(fn => fn(id));
  }

  subscribe(listener: ScopeListener) {
    this.listeners.push(listener);
  }
}

export const sidebarScope = new SidebarScope();
