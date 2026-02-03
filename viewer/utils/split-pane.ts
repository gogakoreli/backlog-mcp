import { resizeService } from './resize.js';

type PaneContent = 'resource' | 'activity';
const STORAGE_KEY = 'openPane';

class SplitPaneService {
  private pane: HTMLElement | null = null;
  private viewer: any = null;
  private rightPane: HTMLElement | null = null;
  private headerContent: HTMLElement | null = null;
  private currentContent: PaneContent | null = null;

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

    // Restore last open pane
    this.restore();
  }

  private restore() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    if (saved.startsWith('activity:')) {
      const taskId = saved.slice(9) || undefined;
      this.openActivity(taskId);
    } else if (saved.startsWith('mcp://')) {
      this.openMcp(saved);
    } else {
      this.open(saved);
    }
  }

  private persist(value: string | null) {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private closePane() {
    if (this.pane) {
      this.pane.remove();
      this.pane = null;
      this.viewer = null;
      this.headerContent = null;
      this.currentContent = null;
    }
  }

  open(path: string) {
    if (!this.rightPane) return;
    this.persist(path);

    // Close if different content type
    if (this.currentContent === 'activity') {
      this.closePane();
    }

    this.currentContent = 'resource';

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

  openMcp(uri: string) {
    if (!this.rightPane) return;
    this.persist(uri);

    // Close if different content type
    if (this.currentContent === 'activity') {
      this.closePane();
    }

    this.currentContent = 'resource';

    if (this.viewer) {
      this.viewer.loadMcpResource(uri);
      this.setHeaderTitle(uri.split('/').pop() || uri, uri);
    } else {
      this.rightPane.classList.add('split-active');
      
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
      
      this.viewer.loadMcpResource(uri);
      this.setHeaderTitle(uri.split('/').pop() || uri, uri);
    }
  }

  close() {
    this.persist(null);
    this.closePane();
    this.rightPane?.classList.remove('split-active');
  }

  isOpen(): boolean {
    return this.pane !== null;
  }

  /**
   * Open activity panel, optionally filtered to a specific task.
   */
  openActivity(taskId?: string) {
    if (!this.rightPane) return;
    this.persist(`activity:${taskId || ''}`);

    // If already showing activity, just update task
    if (this.currentContent === 'activity' && this.viewer) {
      this.viewer.setTaskId(taskId || null);
      this.setHeaderTitle(taskId ? `Activity: ${taskId}` : 'Recent Activity');
      return;
    }

    // Close existing pane if different content type
    if (this.currentContent === 'resource') {
      this.closePane();
    }

    this.rightPane.classList.add('split-active');
    this.currentContent = 'activity';
    
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
      document.dispatchEvent(new CustomEvent('activity-close'));
    });
    
    header.appendChild(this.headerContent);
    header.appendChild(closeBtn);
    
    const content = document.createElement('div');
    content.className = 'pane-content';
    
    this.viewer = document.createElement('activity-panel');
    this.viewer.setTaskId(taskId || null);
    content.appendChild(this.viewer);
    
    this.pane.appendChild(header);
    this.pane.appendChild(content);
    this.rightPane.appendChild(this.pane);
    
    this.setHeaderTitle(taskId ? `Activity: ${taskId}` : 'Recent Activity');
  }

  setHeaderTitle(title: string, subtitle?: string) {
    if (!this.headerContent) return;
    
    this.headerContent.innerHTML = `
      <div class="pane-title">${title}</div>
      ${subtitle ? `<div class="pane-subtitle">${subtitle}</div>` : ''}
    `;
  }

  setHeaderWithUris(title: string, fileUri: string, mcpUri?: string) {
    if (!this.headerContent) return;
    
    const uriSection = document.createElement('div');
    uriSection.className = 'uri-section';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'pane-title';
    titleEl.textContent = title;
    uriSection.appendChild(titleEl);
    
    // File URI row
    const fileRow = this.createUriRow(fileUri, 'file://');
    uriSection.appendChild(fileRow);
    
    // MCP URI row (if available)
    if (mcpUri) {
      const mcpRow = this.createUriRow(mcpUri, 'mcp://');
      uriSection.appendChild(mcpRow);
    }
    
    this.headerContent.innerHTML = '';
    this.headerContent.appendChild(uriSection);
  }

  private createUriRow(uri: string, label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'uri-row';
    
    const labelEl = document.createElement('span');
    labelEl.className = 'uri-label';
    labelEl.textContent = label;
    
    const uriEl = document.createElement('code');
    uriEl.className = 'uri-value';
    uriEl.textContent = uri;
    uriEl.title = uri;
    
    const copyBtn = document.createElement('copy-button');
    copyBtn.id = 'copy-uri-btn';
    copyBtn.textContent = 'Copy';
    (copyBtn as any).text = uri;
    
    row.appendChild(labelEl);
    row.appendChild(uriEl);
    row.appendChild(copyBtn);
    
    return row;
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
