/** Wall-time, event-loop responsiveness and broker traffic limits. These are not a browser-process CPU quota. */
export interface WatchdogLimits {
  heartbeatTimeoutMs: number;
  frameBudgetMs: number;
  maxCallsPerSecond: number;
}

export class PluginWatchdog {
  private readonly limits: WatchdogLimits;
  private readonly stop: (reason: string) => void;
  private readonly now: () => number;
  private readonly started: number;
  private lastBeat: number;
  private windowAt: number;
  private calls = 0;
  private stopped = false;

  constructor(limits: WatchdogLimits, stop: (reason: string) => void, now: () => number = Date.now) {
    this.limits = limits;
    this.stop = stop;
    this.now = now;
    this.started = this.lastBeat = this.windowAt = now();
  }
  heartbeat() {
    this.lastBeat = this.now();
  }
  call() {
    if (this.now() - this.windowAt >= 1000) {
      this.calls = 0;
      this.windowAt = this.now();
    }
    if (++this.calls > this.limits.maxCallsPerSecond) this.kill('broker call budget exceeded');
  }
  check() {
    if (this.now() - this.started >= this.limits.frameBudgetMs) this.kill('frame time budget exceeded');
    else if (this.now() - this.lastBeat >= this.limits.heartbeatTimeoutMs) this.kill('plugin stopped responding to heartbeats');
  }
  private kill(reason: string) {
    if (!this.stopped) {
      this.stopped = true;
      this.stop(reason);
    }
  }
}
