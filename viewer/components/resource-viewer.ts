export class ResourceViewer extends HTMLElement {
  private data: { frontmatter?: any; content: string; path?: string; ext?: string } | null = null;
  private metadataRenderer?: (frontmatter: any) => HTMLElement;
  private _showHeader: boolean = true;

  connectedCallback() {
    this.className = 'resource-viewer';
    if (!this.data) {
      this.showEmpty();
    }
  }

  showEmpty() {
    this.innerHTML = `
      <div class="resource-empty">
        <div class="resource-empty-icon">📄</div>
        <div>Click a file reference to view</div>
      </div>
    `;
  }

  setMetadataRenderer(renderer: (frontmatter: any) => HTMLElement) {
    this.metadataRenderer = renderer;
  }

  setShowHeader(show: boolean) {
    this._showHeader = show;
  }

  loadData(data: { frontmatter?: any; content: string; path?: string; ext?: string }) {
    this.data = data;
    this.render();
  }

  async loadResource(path: string) {
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
      this.dispatchEvent(new CustomEvent('resource-close', { bubbles: true }));
    });

    try {
      const res = await fetch(`/resource?path=${encodeURIComponent(path)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load resource');
      }

      this.loadData(data);
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

  private render() {
    if (!this.data) return;

    this.innerHTML = '';
    this.className = 'resource-viewer';

    // Render based on file type
    if (this.data.ext === 'md' || this.data.frontmatter) {
      this.appendChild(this.renderMarkdownDocument());
    } else if (this.data.ext && ['ts', 'js', 'json', 'txt'].includes(this.data.ext)) {
      this.appendChild(this.renderCode());
    } else {
      const pre = document.createElement('pre');
      pre.textContent = this.data.content;
      this.appendChild(pre);
    }
  }

  private renderMarkdownDocument(): HTMLElement {
    const article = document.createElement('article');
    article.className = 'markdown-body';

    // Render metadata
    if (this.data!.frontmatter && Object.keys(this.data!.frontmatter).length > 0) {
      if (this.metadataRenderer) {
        article.appendChild(this.metadataRenderer(this.data!.frontmatter));
      } else {
        article.appendChild(this.renderDefaultMetadata(this.data!.frontmatter));
      }
    }

    // Render markdown content
    const mdBlock = document.createElement('md-block');
    mdBlock.textContent = this.data!.content;
    article.appendChild(mdBlock);

    // Intercept file:// links
    setTimeout(() => {
      article.querySelectorAll('a[href^="file://"]').forEach(link => {
        const path = link.getAttribute('href')!.replace('file://', '');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.dispatchEvent(new CustomEvent('resource-open', { 
            detail: { path },
            bubbles: true 
          }));
        });
      });
    }, 0);

    return article;
  }

  private renderDefaultMetadata(frontmatter: any): HTMLElement {
    const metaDiv = document.createElement('div');
    metaDiv.className = 'frontmatter-meta';
    metaDiv.innerHTML = `
      <dl class="frontmatter-list">
        ${Object.entries(frontmatter).map(([key, value]) => `
          <div class="frontmatter-item">
            <dt>${key}</dt>
            <dd>${this.formatValue(value)}</dd>
          </div>
        `).join('')}
      </dl>
    `;
    return metaDiv;
  }

  private renderCode(): HTMLElement {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = `language-${this.data!.ext}`;
    code.textContent = this.data!.content;
    pre.appendChild(code);
    
    if ((window as any).hljs) {
      (window as any).hljs.highlightElement(code);
    }
    
    return pre;
  }

  private formatValue(value: any): string {
    if (Array.isArray(value)) {
      return `<ul>${value.map(v => `<li>${this.formatValue(v)}</li>`).join('')}</ul>`;
    }
    if (typeof value === 'object' && value !== null) {
      return `<pre>${JSON.stringify(value, null, 2)}</pre>`;
    }
    return String(value);
  }
}

customElements.define('resource-viewer', ResourceViewer);
