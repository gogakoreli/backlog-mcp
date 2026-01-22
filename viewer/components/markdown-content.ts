export class MarkdownContent extends HTMLElement {
  private _content: string = '';
  private _frontmatter: Record<string, any> = {};

  set content(value: string) {
    this._content = value;
    this.render();
  }

  get content(): string {
    return this._content;
  }

  set frontmatter(value: Record<string, any>) {
    this._frontmatter = value;
    this.render();
  }

  get frontmatter(): Record<string, any> {
    return this._frontmatter;
  }

  private render() {
    const article = document.createElement('article');
    article.className = 'markdown-body';
    
    // Render frontmatter if present
    if (this._frontmatter && Object.keys(this._frontmatter).length > 0) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'frontmatter-meta';
      metaDiv.innerHTML = `
        <dl class="frontmatter-list">
          ${Object.entries(this._frontmatter).map(([key, value]) => `
            <div class="frontmatter-item">
              <dt>${key}</dt>
              <dd>${this.formatValue(value)}</dd>
            </div>
          `).join('')}
        </dl>
      `;
      article.appendChild(metaDiv);
    }
    
    // Render markdown content
    const mdBlock = document.createElement('md-block');
    mdBlock.textContent = this._content;
    article.appendChild(mdBlock);
    
    this.innerHTML = '';
    this.appendChild(article);
    
    // Intercept file:// links and dispatch resource-open events
    this.querySelectorAll('a[href^="file://"]').forEach(link => {
      const path = link.getAttribute('href')!.replace('file://', '');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('resource-open', { 
          detail: { path },
          bubbles: true 
        }));
      });
    });
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

customElements.define('markdown-content', MarkdownContent);
