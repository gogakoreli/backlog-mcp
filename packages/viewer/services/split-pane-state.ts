/**
 * SplitPaneState — Reactive state for the split (right) pane.
 *
 * Replaces the imperative SplitPaneService with signal-driven state.
 * backlog-app reads these signals to render the right pane content
 * reactively using when()/computed views.
 *
 * Components that need to open resources/activity write to these signals
 * instead of calling imperative methods.
 *
 * See ADR 0010 Gap 2, ADR 0011 for design rationale.
 */
import { signal } from '@nisli/core';

export type PaneContent = 'resource' | 'mcp' | 'activity';

const STORAGE_KEY = 'openPane';

export class SplitPaneState {
  /** What type of content the split pane is showing, or null if closed */
  readonly activePane = signal<PaneContent | null>(null);

  /** File path for resource content */
  readonly resourcePath = signal<string | null>(null);

  /** MCP URI for mcp resource content */
  readonly mcpUri = signal<string | null>(null);

  /** Task ID filter for activity panel, or null for all activity */
  readonly activityTaskId = signal<string | null>(null);

  /** Header title for the split pane */
  readonly headerTitle = signal('');

  /** Header subtitle (e.g., file path) */
  readonly headerSubtitle = signal<string | null>(null);

  /** Header file URI for resource loaded events */
  readonly headerFileUri = signal<string | null>(null);

  /** Header MCP URI for resource loaded events */
  readonly headerMcpUri = signal<string | null>(null);

  constructor() {
    this.restore();
  }

  /** Open a file resource in the split pane */
  openResource(path: string) {
    this.activePane.value = 'resource';
    this.resourcePath.value = path;
    this.mcpUri.value = null;
    this.activityTaskId.value = null;
    this.headerTitle.value = path.split('/').pop() || path;
    this.headerSubtitle.value = path;
    this.headerFileUri.value = null;
    this.headerMcpUri.value = null;
    this.persist(path);
  }

  /** Open an MCP resource in the split pane */
  openMcpResource(uri: string) {
    this.activePane.value = 'mcp';
    this.mcpUri.value = uri;
    this.resourcePath.value = null;
    this.activityTaskId.value = null;
    this.headerTitle.value = uri.split('/').pop() || uri;
    this.headerSubtitle.value = uri;
    this.headerFileUri.value = null;
    this.headerMcpUri.value = null;
    this.persist(uri);
  }

  /** Open the activity panel, optionally filtered to a task */
  openActivity(taskId?: string) {
    this.activePane.value = 'activity';
    this.activityTaskId.value = taskId || null;
    this.resourcePath.value = null;
    this.mcpUri.value = null;
    this.headerTitle.value = taskId ? `Activity: ${taskId}` : 'Recent Activity';
    this.headerSubtitle.value = null;
    this.headerFileUri.value = null;
    this.headerMcpUri.value = null;
    this.persist(`activity:${taskId || ''}`);
  }

  /** Close the split pane */
  close() {
    this.activePane.value = null;
    this.resourcePath.value = null;
    this.mcpUri.value = null;
    this.activityTaskId.value = null;
    this.headerTitle.value = '';
    this.headerSubtitle.value = null;
    this.headerFileUri.value = null;
    this.headerMcpUri.value = null;
    this.persist(null);
  }

  /** Update header with URI info (called after resource loads) */
  setHeaderWithUris(title: string, fileUri: string, mcpUri?: string) {
    this.headerTitle.value = title;
    this.headerSubtitle.value = null;
    this.headerFileUri.value = fileUri;
    this.headerMcpUri.value = mcpUri || null;
  }

  /** Clear the activity task filter (show all activity) */
  clearActivityFilter() {
    if (this.activePane.value === 'activity') {
      this.activityTaskId.value = null;
      this.headerTitle.value = 'Recent Activity';
      this.persist('activity:');
    }
  }

  /** Whether the split pane is open */
  get isOpen(): boolean {
    return this.activePane.value !== null;
  }

  // ── Persistence ──────────────────────────────────────────────────

  private persist(value: string | null) {
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* */ }
  }

  private restore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      if (saved.startsWith('activity:')) {
        const taskId = saved.slice(9) || undefined;
        this.openActivity(taskId);
      } else if (saved.startsWith('mcp://')) {
        this.openMcpResource(saved);
      } else {
        this.openResource(saved);
      }
    } catch { /* */ }
  }
}
