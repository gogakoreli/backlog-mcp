class SystemInfoModal extends HTMLElement {
  private isOpen = false;

  connectedCallback() {
    this.render();
    this.attachEventListeners();
  }

  private render() {
    this.innerHTML = `
      <div class="modal-overlay" id="system-modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h2>System Information</h2>
            <button class="modal-close" id="modal-close">&times;</button>
          </div>
          <div class="modal-body" id="modal-body">
            <div class="loading">Loading...</div>
          </div>
        </div>
      </div>
    `;
  }

  private attachEventListeners() {
    const overlay = this.querySelector('#system-modal-overlay');
    const closeBtn = this.querySelector('#modal-close');

    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    closeBtn?.addEventListener('click', () => this.close());
  }

  async open() {
    this.isOpen = true;
    const overlay = this.querySelector('.modal-overlay') as HTMLElement;
    overlay.style.display = 'flex';
    await this.loadSystemInfo();
  }

  close() {
    this.isOpen = false;
    const overlay = this.querySelector('.modal-overlay') as HTMLElement;
    overlay.style.display = 'none';
  }

  private async loadSystemInfo() {
    const body = this.querySelector('#modal-body');
    if (!body) return;

    try {
      const response = await fetch('/api/status');
      const data = await response.json();

      body.innerHTML = `
        <div class="info-grid">
          <div class="info-row">
            <span class="info-label">Version</span>
            <span class="info-value">${data.version}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Port</span>
            <span class="info-value">${data.port}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Data Directory</span>
            <span class="info-value">
              <code>${data.dataDir}</code>
              <button class="copy-btn" data-copy="${data.dataDir}">Copy</button>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Task Count</span>
            <span class="info-value">${data.taskCount}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Uptime</span>
            <span class="info-value">${this.formatUptime(data.uptime)}</span>
          </div>
        </div>
      `;

      // Attach copy button handler
      body.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = btn.getAttribute('data-copy');
          if (text) {
            navigator.clipboard.writeText(text);
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 2000);
          }
        });
      });
    } catch (error) {
      body.innerHTML = `<div class="error">Failed to load system info</div>`;
    }
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
}

customElements.define('system-info-modal', SystemInfoModal);
