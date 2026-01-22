class ResizeService {
  private resizing = false;
  private currentHandle: HTMLElement | null = null;
  private startX = 0;
  private startWidth = 0;
  private container: HTMLElement | null = null;
  private leftPane: HTMLElement | null = null;

  init() {
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', () => this.onMouseUp());
  }

  createHandle(container: HTMLElement, leftPane: HTMLElement, storageKey: string): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.addEventListener('mousedown', (e) => this.onMouseDown(e, container, leftPane, storageKey));
    
    // Restore saved width
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      leftPane.style.width = saved;
    }
    
    return handle;
  }

  private onMouseDown(e: MouseEvent, container: HTMLElement, leftPane: HTMLElement, storageKey: string) {
    e.preventDefault();
    this.resizing = true;
    this.currentHandle = e.target as HTMLElement;
    this.container = container;
    this.leftPane = leftPane;
    this.startX = e.clientX;
    this.startWidth = leftPane.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.resizing || !this.container || !this.leftPane) return;

    const delta = e.clientX - this.startX;
    const newWidth = this.startWidth + delta;
    const containerWidth = this.container.offsetWidth;
    const minWidth = 200;
    const maxWidth = containerWidth - 200;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      const percentage = (newWidth / containerWidth) * 100;
      this.leftPane.style.width = `${percentage}%`;
    }
  }

  private onMouseUp() {
    if (!this.resizing) return;
    
    this.resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Save to localStorage
    if (this.leftPane && this.currentHandle) {
      const storageKey = this.currentHandle.dataset.storageKey;
      if (storageKey) {
        localStorage.setItem(storageKey, this.leftPane.style.width);
      }
    }
    
    this.currentHandle = null;
    this.container = null;
    this.leftPane = null;
  }
}

export const resizeService = new ResizeService();
