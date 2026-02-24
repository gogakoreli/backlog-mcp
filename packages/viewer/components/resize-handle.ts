/**
 * resize-handle.ts — Declarative resize handle component.
 *
 * Place between two flex siblings. Resizes its previousElementSibling
 * by dragging. Persists width to localStorage via storageKey prop.
 *
 * ```
 * <div class="left-pane">...</div>
 * ${ResizeHandle({ storageKey: signal('leftPaneWidth') })}
 * <div class="right-pane">...</div>
 * ```
 */
import { component, html, onMount, onCleanup, useHostEvent } from '@nisli/core';

type ResizeHandleProps = {
  storageKey: string;
};

const MIN_WIDTH = 200;

export const ResizeHandle = component<ResizeHandleProps>('resize-handle', (props, host) => {
  let resizing = false;
  let startX = 0;
  let startWidth = 0;
  let target: HTMLElement | null = null;
  let container: HTMLElement | null = null;

  host.classList.add('resize-handle');

  onMount(() => {
    target = host.previousElementSibling as HTMLElement;
    container = host.parentElement;
    if (target) {
      const saved = localStorage.getItem(props.storageKey.value);
      if (saved) target.style.width = saved;
    }
  });

  useHostEvent(host, 'mousedown', (e: MouseEvent) => {
    if (!target || !container) return;
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = target.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  const onMouseMove = (e: MouseEvent) => {
    if (!resizing || !target || !container) return;
    const newWidth = startWidth + (e.clientX - startX);
    const maxWidth = container.offsetWidth - MIN_WIDTH;
    if (newWidth >= MIN_WIDTH && newWidth <= maxWidth) {
      target.style.width = `${(newWidth / container.offsetWidth) * 100}%`;
    }
  };

  const onMouseUp = () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (target) {
      localStorage.setItem(props.storageKey.value, target.style.width);
    }
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  onCleanup(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });

  return html``;
});
