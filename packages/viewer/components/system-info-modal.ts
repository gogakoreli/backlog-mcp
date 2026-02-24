/**
 * system-info-modal.ts — Reactive modal for displaying server system information.
 *
 * Reads AppState.isSystemInfoOpen to show/hide. Fetches system info via query()
 * on open. Uses CopyButton factory composition for the data directory copy action.
 *
 * See ADR 0007 (shared services) for the open/close signal pattern.
 */
import { computed, component, html, inject, query, onMount } from 'nisli';
import { AppState } from '../services/app-state.js';
import { CopyButton } from './copy-button.js';
import { API_URL } from '../utils/api.js';

interface SystemInfo {
  version: string;
  port: number;
  dataDir: string;
  taskCount: number;
  uptime: number;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export const SystemInfoModal = component('system-info-modal', (_props, _host) => {
  const app = inject(AppState);

  // ── Data loading — only fetches when modal is open ──────────────
  const infoQuery = query<SystemInfo>(
    () => ['system-info', app.isSystemInfoOpen.value],
    () => fetch(`${API_URL}/api/status`).then(r => r.json()),
    {
      enabled: () => app.isSystemInfoOpen.value,
      staleTime: 0, // always refetch on open
    },
  );

  const info = infoQuery.data;
  const loading = infoQuery.loading;
  const error = computed(() => infoQuery.error.value?.message ?? null);

  // ── Actions ────────────────────────────────────────────────────
  function close() {
    app.isSystemInfoOpen.value = false;
  }

  function handleOverlayClick(e: Event) {
    if (e.target === (e.currentTarget as HTMLElement)) close();
  }

  // ── Keyboard: Escape to close ──────────────────────────────────
  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (app.isSystemInfoOpen.value && e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  // ── Derived state (flat — no nested computed in templates) ─────
  const version = computed(() => info.value?.version ?? '');
  const port = computed(() => String(info.value?.port ?? ''));
  const dataDir = computed(() => info.value?.dataDir ?? '');
  const taskCount = computed(() => String(info.value?.taskCount ?? ''));
  const uptime = computed(() => info.value ? formatUptime(info.value.uptime) : '');
  const overlayDisplay = computed(() => app.isSystemInfoOpen.value ? 'flex' : 'none');

  const copyDirBtn = CopyButton({ text: dataDir, content: html`Copy` });

  // ── Body: 3-way branch via computed view (tmpl-computed-views) ─
  const infoGridView = html`
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Version</span>
        <span class="info-value">${version}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Port</span>
        <span class="info-value">${port}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Data Directory</span>
        <span class="info-value">
          <code>${dataDir}</code>
          ${copyDirBtn}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Task Count</span>
        <span class="info-value">${taskCount}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Uptime</span>
        <span class="info-value">${uptime}</span>
      </div>
    </div>
  `;

  const bodyContent = computed(() => {
    if (error.value) return html`<div class="error">Failed to load system info</div>`;
    if (loading.value && !info.value) return html`<div class="loading">Loading...</div>`;
    return infoGridView;
  });

  // ── Template ───────────────────────────────────────────────────
  return html`
    <div class="modal-overlay" style="${computed(() => `display:${overlayDisplay.value}`)}" @click="${handleOverlayClick}">
      <div class="modal-content">
        <div class="modal-header">
          <h2>System Information</h2>
          <button class="modal-close" @click="${close}">&times;</button>
        </div>
        <div class="modal-body">
          ${bodyContent}
        </div>
      </div>
    </div>
  `;
});
