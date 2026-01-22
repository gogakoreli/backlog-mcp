export class ResourceViewer extends HTMLElement {
  private currentPath: string | null = null;

  connectedCallback() {
    this.className = 'resource-viewer';
    this.showEmpty();
  }

  showEmpty() {
    this.innerHTML = `
      <div class="resource-empty">
        <div class="resource-empty-icon">📄</div>
        <div>Click a file reference to view</div>
      </div>
    `;
  }

  async loadResource(path: string) {
    this.currentPath = path;
    const filename = path.split('/').pop() || path;
    
    this.innerHTML = `
      <div class="resource-header">
        <span class="resource-filename" title="${path}">${filename}</span>
        <button class="resource-close" title="Close (Cmd+W)">✕</button>
      </div>
      <div class="resource-content">
        <div class="resource-loading">Loading...</div>
      </div>
    `;

    this.querySelector('.resource-close')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('resource-close'));
    });

    try {
      const res = await fetch(`/resource?path=${encodeURIComponent(path)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load resource');
      }

      const contentDiv = this.querySelector('.resource-content');
      if (!contentDiv) return;

      if (data.ext === 'md') {
        const markdownContent = document.createElement('markdown-content') as any;
        markdownContent.content = data.content;
        markdownContent.frontmatter = data.frontmatter || {};
        contentDiv.innerHTML = '';
        contentDiv.appendChild(markdownContent);
      } else if (['ts', 'js', 'json', 'txt'].includes(data.ext)) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = `language-${data.ext}`;
        code.textContent = data.content;
        pre.appendChild(code);
        contentDiv.innerHTML = '';
        contentDiv.appendChild(pre);
        
        // Syntax highlighting if available
        if ((window as any).hljs) {
          (window as any).hljs.highlightElement(code);
        }
      } else {
        contentDiv.innerHTML = `<pre>${data.content}</pre>`;
      }
    } catch (error) {
      const contentDiv = this.querySelector('.resource-content');
      if (contentDiv) {
        contentDiv.innerHTML = `
          <div class="resource-error">
            <div>Failed to load file</div>
            <div class="resource-error-detail">${(error as Error).message}</div>
          </div>
        `;
      }
    }
  }
}

customElements.define('resource-viewer', ResourceViewer);
