import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalEventBus } from '../events/local-event-bus.js';

describe('LocalEventBus', () => {
  let bus: LocalEventBus;

  beforeEach(() => {
    bus = new LocalEventBus();
  });

  const makeEvent = (id: string) => ({
    type: 'task_changed' as const,
    id,
    tool: 'backlog_update',
    actor: 'test',
    ts: new Date().toISOString(),
  });

  it('should assign incrementing sequence numbers', () => {
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));

    bus.emit(makeEvent('TASK-0001'));
    bus.emit(makeEvent('TASK-0002'));

    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
  });

  it('should notify all subscribers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    bus.subscribe(cb1);
    bus.subscribe(cb2);
    bus.emit(makeEvent('TASK-0001'));

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('should stop notifying after unsubscribe', () => {
    const cb = vi.fn();

    bus.subscribe(cb);
    bus.emit(makeEvent('TASK-0001'));
    expect(cb).toHaveBeenCalledOnce();

    bus.unsubscribe(cb);
    bus.emit(makeEvent('TASK-0002'));
    expect(cb).toHaveBeenCalledOnce(); // still 1
  });

  it('should replay events since a given sequence number', () => {
    bus.emit(makeEvent('TASK-0001'));
    bus.emit(makeEvent('TASK-0002'));
    bus.emit(makeEvent('TASK-0003'));

    const missed = bus.replaySince(1);
    expect(missed).toHaveLength(2);
    expect(missed[0].id).toBe('TASK-0002');
    expect(missed[1].id).toBe('TASK-0003');
  });

  it('should return empty array when replaying from current seq', () => {
    bus.emit(makeEvent('TASK-0001'));
    expect(bus.replaySince(1)).toHaveLength(0);
  });

  it('should respect ring buffer size limit', () => {
    // Emit more than buffer size (1000)
    for (let i = 0; i < 1050; i++) {
      bus.emit(makeEvent(`TASK-${i.toString().padStart(4, '0')}`));
    }

    // Replay from seq 0 should only return last 1000
    const all = bus.replaySince(0);
    expect(all).toHaveLength(1000);
    expect(all[0].seq).toBe(51); // first 50 dropped
    expect(all[999].seq).toBe(1050);
  });
});
