/**
 * Centralized real-time update service for the viewer.
 *
 * Owns the SSE connection and provides a simple subscribe/unsubscribe
 * API for components. Components have zero knowledge of SSE, EventSource,
 * or transport details — they just register callbacks.
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

export type ChangeCallback = (event: BacklogEvent) => void;

class BacklogEvents {
  private source: EventSource | null = null;
  private listeners = new Set<ChangeCallback>();

  /** Start listening for server events. Call once on app init. */
  connect(): void {
    if (this.source) return;

    this.source = new EventSource(`${API_URL}/events`);

    this.source.onmessage = (e) => {
      try {
        const event: BacklogEvent = JSON.parse(e.data);
        for (const cb of this.listeners) {
          cb(event);
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }

  /** Subscribe to all backlog change events. */
  onChange(callback: ChangeCallback): void {
    this.listeners.add(callback);
  }

  /** Unsubscribe from change events. */
  offChange(callback: ChangeCallback): void {
    this.listeners.delete(callback);
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }
}

export const backlogEvents = new BacklogEvents();
