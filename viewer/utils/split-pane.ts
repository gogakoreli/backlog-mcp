class SplitPaneService {
  private pane: HTMLElement | null = null;
  private viewer: any = null;
  private rightPane: HTMLElement | null = null;

  init() {
    this.rightPane = document.getElementById('right-pane');
  }

  open(path: string) {
    if (!this.rightPane) return;

    if (this.viewer) {
      this.viewer.loadResource(path);
      this.updateHeader(path);
    } else {
      this.rightPane.classList.add('split-active');
      
      // Create proper pane structure
      this.pane = document.createElement('div');
      this.pane.className = 'resource-pane';
      
      const header = document.createElement('div');
      header.className = 'pane-header';
      header.innerHTML = `
        <div class="pane-title" id="resource-pane-title"></div>
        <button class="btn-outline resource-close-btn" title="Close (Cmd+W)">✕</button>
      `;
      
      const content = document.createElement('div');
      content.className = 'pane-content';
      
      this.viewer = document.createElement('resource-viewer');
      this.viewer.setShowHeader(false);
      content.appendChild(this.viewer);
      
      this.pane.appendChild(header);
      this.pane.appendChild(content);
      this.rightPane.appendChild(this.pane);
      
      // Bind close button
      header.querySelector('.resource-close-btn')?.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('resource-close'));
      });
      
      this.viewer.loadResource(path);
      this.updateHeader(path);
    }
  }

  close() {
    if (this.pane) {
      this.pane.remove();
      this.pane = null;
      this.viewer = null;
    }
    this.rightPane?.classList.remove('split-active');
  }

  isOpen(): boolean {
    return this.pane !== null;
  }

  private updateHeader(path: string) {
    const filename = path.split('/').pop() || path;
    const titleEl = document.getElementById('resource-pane-title');
    if (titleEl) {
      titleEl.textContent = filename;
      titleEl.title = path;
    }
  }
}

export const splitPane = new SplitPaneService();
