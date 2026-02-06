/**
 * In-process EventBus implementation using Node.js EventEmitter.
 * Maintains a ring buffer for replay on SSE reconnect.
 */

import { EventEmitter } from 'node:events';
import type { BacklogEvent, BacklogEventCallback, EventBus } from './event-bus.js';

const RING_BUFFER_SIZE = 1000;
const EVENT_NAME = 'backlog';

export class LocalEventBus implements EventBus {
  private emitter = new EventEmitter();
  private seq = 0;
  private buffer: BacklogEvent[] = [];

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: Omit<BacklogEvent, 'seq'>): void {
    const full: BacklogEvent = { ...event, seq: ++this.seq };

    // Ring buffer: drop oldest when full
    if (this.buffer.length >= RING_BUFFER_SIZE) {
      this.buffer.shift();
    }
    this.buffer.push(full);

    this.emitter.emit(EVENT_NAME, full);
  }

  subscribe(callback: BacklogEventCallback): void {
    this.emitter.on(EVENT_NAME, callback);
  }

  unsubscribe(callback: BacklogEventCallback): void {
    this.emitter.off(EVENT_NAME, callback);
  }

  replaySince(seq: number): BacklogEvent[] {
    return this.buffer.filter(e => e.seq > seq);
  }
}
