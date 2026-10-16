/**
 * A sliding-window limiter, in memory and per process: at most `max` hits per `windowMs` for each key. Enough to stop
 * one signed-in person (or one anonymous deployment) flooding a replay's comments; it is not a global quota, and a
 * restart forgets it.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Records a hit for `key`. Returns 0 when allowed, else the whole seconds until the next hit would be. */
  hit(key: string): number {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(now);
    return 0;
  }

  private sweep(now: number) {
    for (const [key, times] of this.hits) if (times.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
  }
}
