import { signal, effect } from '../framework/signal.js';
import { component } from '../framework/component.js';
import { html, type TemplateResult } from '../framework/template.js';
import { SvgIcon } from './svg-icon.js';
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

function showTooltip(anchor: HTMLElement, message: string) {
  if (hideTimeout) clearTimeout(hideTimeout);

  const tooltip = getTooltip();
  const rect = anchor.getBoundingClientRect();
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

  hideTimeout = window.setTimeout(() => { tooltip.style.opacity = '0'; }, 1500);
}

export const CopyButton = component<{ text: string; content?: TemplateResult }>('copy-button', (props, host) => {
  host.classList.add('btn-outline');

  const onClick = async () => {
    const text = props.text.value;
    try {
      await navigator.clipboard.writeText(text);
      showTooltip(host, 'Copied!');
      const liveRegion = document.getElementById('copy-live-region');
      if (liveRegion) {
        liveRegion.textContent = 'Copied to clipboard';
        setTimeout(() => liveRegion.textContent = '', 1500);
      }
    } catch (err) {
      showTooltip(host, 'Failed to copy');
      console.error('Copy failed:', err);
    }
  };

  // HACK:EXPOSE — task-detail pane header (HACK:CROSS_QUERY) and split-pane's
  // createUriRow still set .text imperatively. Remove when pane header is
  // refactored to use factory composition and split-pane is migrated.
  (host as any).text = '';
  Object.defineProperty(host, 'text', {
    set: (v: string) => { props.text.value = v; },
    get: () => props.text.value,
  });

  // HACK:MOUNT_APPEND — mountTemplate appends instead of replacing host children.
  // task-detail pane header (HACK:CROSS_QUERY) and split-pane create children
  // via innerHTML that persist. Remove when all consumers use factory composition.
  host.addEventListener('click', onClick);

  const icon = SvgIcon({ src: signal(copyIcon) });

  return html`${props.content} ${icon}`;
});
