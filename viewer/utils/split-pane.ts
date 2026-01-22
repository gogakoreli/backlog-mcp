import { resizeService } from './resize.js';

class SplitPaneService {
  private pane: HTMLElement | null = null;
  private viewer: any = null;
  private rightPane: HTMLElement | null = null;
  private headerContent: HTMLElement | null = null;

  init() {
    this.rightPane = document.getElementById('right-pane');
    
    // Add resize handle between task and resource panes (always present)
    const taskPane = this.rightPane?.querySelector('.task-pane') as HTMLElement;
    if (this.rightPane && taskPane) {
      const savedWidth = localStorage.getItem('taskPaneWidth');
      if (savedWidth) {
        taskPane.style.width = savedWidth;
      }
      
      const handle = resizeService.createHandle(this.rightPane, taskPane, 'taskPaneWidth');
      handle.dataset.storageKey = 'taskPaneWidth';
      handle.classList.add('split-resize-handle');
      this.rightPane.appendChild(handle);
    }
  }

  open(path: string) {
    if (!this.rightPane) return;

    if (this.viewer) {
      this.viewer.loadResource(path);
      this.setHeaderTitle(path.split('/').pop() || path, path);
    } else {
      this.rightPane.classList.add('split-active');
      
      // Create proper pane structure
      this.pane = document.createElement('div');
      this.pane.className = 'resource-pane';
      
      const header = document.createElement('div');
      header.className = 'pane-header';
      
      this.headerContent = document.createElement('div');
      this.headerContent.className = 'pane-header-content';
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-outline resource-close-btn';
      closeBtn.title = 'Close (Cmd+W)';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('resource-close'));
      });
      
      header.appendChild(this.headerContent);
      header.appendChild(closeBtn);
      
      const content = document.createElement('div');
      content.className = 'pane-content';
      
      this.viewer = document.createElement('resource-viewer');
      this.viewer.setShowHeader(false);
      content.appendChild(this.viewer);
      
      this.pane.appendChild(header);
      this.pane.appendChild(content);
      this.rightPane.appendChild(this.pane);
      
      this.viewer.loadResource(path);
      this.setHeaderTitle(path.split('/').pop() || path, path);
    }
  }

  close() {
    if (this.pane) {
      this.pane.remove();
      this.pane = null;
      this.viewer = null;
      this.headerContent = null;
    }
    
    // Keep resize handle - don't remove it
    this.rightPane?.classList.remove('split-active');
  }

  isOpen(): boolean {
    return this.pane !== null;
  }

  setHeaderTitle(title: string, subtitle?: string) {
    if (!this.headerContent) return;
    
    this.headerContent.innerHTML = `
      <div class="pane-title">${title}</div>
      ${subtitle ? `<div class="pane-subtitle">${subtitle}</div>` : ''}
    `;
  }

  setHeaderContent(element: HTMLElement) {
    if (!this.headerContent) return;
    this.headerContent.innerHTML = '';
    this.headerContent.appendChild(element);
  }

  getViewer(): any {
    return this.viewer;
  }
}

export const splitPane = new SplitPaneService();
