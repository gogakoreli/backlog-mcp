import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Supervisor, SupervisorConfig } from '../cli/supervisor.js';

describe('Supervisor', () => {
  const config: SupervisorConfig = {
    maxRestarts: 3,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    successThresholdMs: 1000,
  };

  let supervisor: Supervisor;

  beforeEach(() => {
    supervisor = new Supervisor(config);
  });

  describe('onExit', () => {
    it('should return stop on normal exit (code 0)', () => {
      supervisor.onStart();
      const result = supervisor.onExit(0);
      expect(result.action).toBe('stop');
    });

    it('should return stop on signal exit (code null)', () => {
      supervisor.onStart();
      const result = supervisor.onExit(null);
      expect(result.action).toBe('stop');
    });

    it('should return restart on abnormal exit', () => {
      supervisor.onStart();
      const result = supervisor.onExit(1);
      expect(result.action).toBe('restart');
      expect(result.delay).toBe(100);
      expect(result.restartCount).toBe(1);
    });

    it('should apply exponential backoff', () => {
      supervisor.onStart();
      
      const r1 = supervisor.onExit(1);
      expect(r1.delay).toBe(100);
      
      supervisor.onStart();
      const r2 = supervisor.onExit(1);
      expect(r2.delay).toBe(200);
      
      supervisor.onStart();
      const r3 = supervisor.onExit(1);
      expect(r3.delay).toBe(400);
    });

    it('should cap delay at maxDelayMs', () => {
      supervisor.onStart();
      supervisor.onExit(1); // 100
      supervisor.onStart();
      supervisor.onExit(1); // 200
      supervisor.onStart();
      supervisor.onExit(1); // 400 - give up at 3
      
      // New supervisor to test cap
      const sv = new Supervisor({ ...config, maxRestarts: 10 });
      for (let i = 0; i < 5; i++) {
        sv.onStart();
        sv.onExit(1);
      }
      const state = sv.getState();
      expect(state.delay).toBeLessThanOrEqual(config.maxDelayMs);
    });

    it('should give up after maxRestarts', () => {
      supervisor.onStart();
      supervisor.onExit(1);
      supervisor.onStart();
      supervisor.onExit(1);
      supervisor.onStart();
      supervisor.onExit(1);
      supervisor.onStart();
      
      const result = supervisor.onExit(1);
      expect(result.action).toBe('give-up');
      expect(result.restartCount).toBe(4);
    });

    it('should reset backoff after successful run', () => {
      // Mock Date.now to simulate time passing
      const now = Date.now();
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(now)           // onStart
        .mockReturnValueOnce(now + 500)     // onExit (short run)
        .mockReturnValueOnce(now + 500)     // onStart
        .mockReturnValueOnce(now + 2000)    // onExit (long run > 1000ms threshold)
        .mockReturnValueOnce(now + 2000);   // onStart after reset

      supervisor.onStart();
      const r1 = supervisor.onExit(1);
      expect(r1.restartCount).toBe(1);
      expect(r1.delay).toBe(100);

      supervisor.onStart();
      const r2 = supervisor.onExit(1);
      // Should reset because run was > successThresholdMs
      expect(r2.restartCount).toBe(1); // Reset to 1
      expect(r2.delay).toBe(100);      // Reset to initial

      vi.restoreAllMocks();
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = supervisor.getState();
      expect(state.restartCount).toBe(0);
      expect(state.delay).toBe(100);
    });
  });
});
