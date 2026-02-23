/**
 * Supervisor manages restart logic with exponential backoff.
 * Extracted for testability - no child process or I/O dependencies.
 */
export interface SupervisorConfig {
  maxRestarts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  successThresholdMs: number;
}

export const DEFAULT_CONFIG: SupervisorConfig = {
  maxRestarts: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  successThresholdMs: 30000,
};

export class Supervisor {
  private restartCount = 0;
  private delay: number;
  private startTime = 0;
  
  constructor(private config: SupervisorConfig = DEFAULT_CONFIG) {
    this.delay = config.initialDelayMs;
  }
  
  /** Call when process starts */
  onStart(): void {
    this.startTime = Date.now();
  }
  
  /** 
   * Call when process exits. Returns action to take.
   * @param code - exit code (0 = normal, null = signal, other = crash)
   */
  onExit(code: number | null): { action: 'stop' | 'restart' | 'give-up'; delay?: number; restartCount?: number } {
    // Normal exit or signal - stop
    if (code === 0 || code === null) {
      return { action: 'stop' };
    }
    
    // Reset if ran successfully for a while
    const runDuration = Date.now() - this.startTime;
    if (runDuration > this.config.successThresholdMs) {
      this.restartCount = 0;
      this.delay = this.config.initialDelayMs;
    }
    
    this.restartCount++;
    
    if (this.restartCount > this.config.maxRestarts) {
      return { action: 'give-up', restartCount: this.restartCount };
    }
    
    const currentDelay = this.delay;
    this.delay = Math.min(this.delay * 2, this.config.maxDelayMs);
    
    return { action: 'restart', delay: currentDelay, restartCount: this.restartCount };
  }
  
  /** Get current state for testing/logging */
  getState(): { restartCount: number; delay: number } {
    return { restartCount: this.restartCount, delay: this.delay };
  }
}
