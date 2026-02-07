type State = {
  filter: string;
  type: string;
  id: string | null;
  q: string | null;
};

type Listener = (state: State) => void;

class UrlState {
  private listeners: Listener[] = [];
  private pushing = false;

  constructor() {
    window.addEventListener('popstate', () => this.notify());
  }

  get(): State {
    const params = new URLSearchParams(window.location.search);

    // Backward compat: redirect ?epic=&task= to ?id=
    if (params.has('epic') || params.has('task')) {
      const id = params.get('task') || params.get('epic');
      const url = new URL(window.location.href);
      url.searchParams.delete('epic');
      url.searchParams.delete('task');
      if (id) url.searchParams.set('id', id);
      history.replaceState(null, '', url);
      return this.get();
    }

    return {
      filter: params.get('filter') || 'active',
      type: params.get('type') || 'all',
      id: params.get('id'),
      q: params.get('q'),
    };
  }

  set(updates: Partial<State>) {
    if (this.pushing) return;
    this.pushing = true;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(updates)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history.pushState(null, '', url);
    this.notify();
    this.pushing = false;
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
  }

  notify() {
    const state = this.get();
    this.listeners.forEach(fn => fn(state));
  }

  init() {
    this.notify();
  }
}

export const urlState = new UrlState();
