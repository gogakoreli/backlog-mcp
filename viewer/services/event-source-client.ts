/**
 * EventSource client for receiving real-time backlog change notifications.
 *
 * Wraps the browser EventSource API and dispatches DOM custom events
 * that viewer components can subscribe to. Falls back to polling
 * if the SSE connection fails repeatedly.
 */

import { API_URL } from '../utils/api.js';

export type BacklogEventType = 'task_changed' | 'task_created' | 'task_deleted' | 'resource_changed';

export interface BacklogEvent {
  seq: number;
  type: BacklogEventType;
  id: string;
  tool: string;
  actor: string;
  ts: string;
}

const MAX_RETRIES = 3;
const DOM_EVENT_PREFIX = 'backlog:';

class EventSourceClient {
  private source: EventSource | null = null;
  private failCount = 0;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.source) return;

    this.source = new EventSource(`${API_URL}/events`);

    this.source.onopen = () => {
      this.failCount = 0;
      this._connected = true;
      document.dispatchEvent(new CustomEvent(`${DOM_EVENT_PREFIX}connected`));
    };

    this.source.onmessage = (e) => {
      try {
        const event: BacklogEvent = JSON.parse(e.data);
        // Dispatch typed event (e.g., 'backlog:task_changed')
        document.dispatchEvent(new CustomEvent(`${DOM_EVENT_PREFIX}${event.type}`, { detail: event }));
        // Dispatch generic event for components that want all changes
        document.dispatchEvent(new CustomEvent(`${DOM_EVENT_PREFIX}change`, { detail: event }));
      } catch {
        // Ignore malformed messages
      }
    };

    this.source.onerror = () => {
      this._connected = false;
      this.failCount++;

      if (this.failCount >= MAX_RETRIES) {
        // Stop trying — components fall back to polling
        this.source?.close();
        this.source = null;
        document.dispatchEvent(new CustomEvent(`${DOM_EVENT_PREFIX}disconnected`));
      }
      // Otherwise EventSource auto-reconnects
    };
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
    this._connected = false;
  }
}

export const sseClient = new EventSourceClient();
