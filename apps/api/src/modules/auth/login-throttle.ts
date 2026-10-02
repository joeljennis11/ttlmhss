/**
 * Repeated-failure protection per username (complements per-IP rate limiting on the route).
 *
 * After `maxFailures` failed attempts within `lockoutMs`, further attempts for that username are
 * refused until the window passes — even with the right password. Unknown usernames are tracked
 * exactly like real ones, so the lock reveals nothing about which accounts exist.
 *
 * In-memory: correct for a single API process. Running several instances would need a shared
 * store (documented limitation).
 */
export interface LoginThrottleOptions {
  maxFailures: number;
  lockoutMs: number;
  /** Bound on tracked keys so the map cannot grow without limit. */
  maxEntries?: number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;

  constructor(private readonly options: LoginThrottleOptions) {
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  isLocked(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.lockedUntil > now;
  }

  recordFailure(key: string, now: number): void {
    const windowStart = now - this.options.lockoutMs;
    const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => t > windowStart);
    entry.failures.push(now);
    if (entry.failures.length >= this.options.maxFailures) {
      entry.lockedUntil = now + this.options.lockoutMs;
      entry.failures = [];
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
