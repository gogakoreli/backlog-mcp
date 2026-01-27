import { copyIcon } from '../icons/index.js';

// Shared tooltip for all copy buttons
let sharedTooltip: HTMLDivElement | null = null;
let hideTimeout: number | undefined;

function getTooltip(): HTMLDivElement {
  if (!sharedTooltip) {
    sharedTooltip = document.createElement('div');
    sharedTooltip.style.cssText = `
      position: fixed;
      background: #2d2d30;
      color: #fff;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid #444c56;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ease;
      z-index: 10000;
    `;
    document.body.appendChild(sharedTooltip);
  }
  return sharedTooltip;
}

class CopyButton extends HTMLElement {
  private _text: string = '';

  set text(value: string) {
    this._text = value;
  }

  get text(): string {
    return this._text;
  }

  connectedCallback() {
    const content = this.innerHTML;
    
    this.classList.add('btn-outline');
    this.innerHTML = `${content} <svg-icon src="${copyIcon}"></svg-icon>`;
    this.addEventListener('click', () => this.copy(this._text));
  }

  private async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.showTooltip('Copied!');
      
      const liveRegion = document.getElementById('copy-live-region');
      if (liveRegion) {
        liveRegion.textContent = 'Copied to clipboard';
        setTimeout(() => liveRegion.textContent = '', 1500);
      }
    } catch (err) {
      this.showTooltip('Failed to copy');
      console.error('Copy failed:', err);
    }
  }

  private showTooltip(message: string) {
    if (hideTimeout) clearTimeout(hideTimeout);

    const tooltip = getTooltip();
    const rect = this.getBoundingClientRect();
    const tooltipWidth = 80;
    const tooltipHeight = 32;

    let left = rect.left + rect.width / 2;
    let top = rect.top - 8;
    let transform = 'translate(-50%, -100%)';

    if (top - tooltipHeight < 0) {
      top = rect.bottom + 8;
      transform = 'translate(-50%, 0%)';
    }

    if (left + tooltipWidth / 2 > window.innerWidth) {
      left = window.innerWidth - tooltipWidth / 2 - 8;
    }
    if (left - tooltipWidth / 2 < 0) {
      left = tooltipWidth / 2 + 8;
    }

    tooltip.textContent = message;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = transform;
    tooltip.style.opacity = '1';

    hideTimeout = window.setTimeout(() => {
      tooltip.style.opacity = '0';
    }, 1500);
  }
}

customElements.define('copy-button', CopyButton);
