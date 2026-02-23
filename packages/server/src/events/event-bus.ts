/**
 * EventBus interface and event types for real-time viewer updates.
 *
 * The interface is designed to be pluggable: start with in-process
 * EventEmitter (LocalEventBus), swap to Redis Pub/Sub or NATS
 * for cloud deployment without changing consumers.
 */

export type BacklogEventType = 'task_changed' | 'task_created' | 'task_deleted' | 'resource_changed';

export interface BacklogEvent {
  seq: number;
  type: BacklogEventType;
  id: string;
  tool: string;
  actor: string;
  ts: string;
}

export type BacklogEventCallback = (event: BacklogEvent) => void;

export interface EventBus {
  emit(event: Omit<BacklogEvent, 'seq'>): void;
  subscribe(callback: BacklogEventCallback): void;
  unsubscribe(callback: BacklogEventCallback): void;
  replaySince(seq: number): BacklogEvent[];
}
