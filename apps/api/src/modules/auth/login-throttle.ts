/**
 * Repeated-failure protection for sign-in (complements the per-IP route rate limit).
 *
 * Phase 12C (D-121) — two layers, so that a whole school behind one public address keeps working
 * and an attacker cannot lock a teacher out from elsewhere just by knowing the username:
 *
 * 1. Per username + source address: `maxFailures` failures within `lockoutMs` lock that username
 *    for THAT address only, for `lockoutMs` (then it unlocks by itself — never permanent).
 * 2. Per username across all addresses: `accountMaxFailures` failures within `lockoutMs` (a
 *    distributed guessing attempt) lock the username for every address EXCEPT the ones it has
 *    recently signed in from successfully (remembered for `trustMs`). The real user on their
 *    usual network is not locked out by someone guessing from elsewhere.
 *
 * Unknown usernames are tracked exactly like real ones, so a lock reveals nothing about which
 * accounts exist. Generic `isLocked` / `recordFailure` / `reset` keep serving the password-change
 * throttle (per account).
 *
 * In-memory: correct for the supported single API process (D-123); several processes would each
 * count separately.
 */
export interface LoginThrottleOptions {
  maxFailures: number;
  lockoutMs: number;
  /** Failures for one username from all addresses before the account-wide lock (default 4 × maxFailures). */
  accountMaxFailures?: number;
  /** How long a successful sign-in from an address is remembered (default 30 days). */
  trustMs?: number;
  /** Bound on tracked keys so the maps cannot grow without limit. */
  maxEntries?: number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly trusted = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly accountMax: number;
  private readonly trustMs: number;

  constructor(private readonly options: LoginThrottleOptions) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.accountMax = options.accountMaxFailures ?? options.maxFailures * 4;
    this.trustMs = options.trustMs ?? 30 * 86_400_000;
  }

  // ---- generic (one key) ---------------------------------------------------------------------

  isLocked(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.lockedUntil > now;
  }

  recordFailure(key: string, now: number, max = this.options.maxFailures): void {
    const windowStart = now - this.options.lockoutMs;
    const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => t > windowStart);
    entry.failures.push(now);
    if (entry.failures.length >= max) {
      entry.lockedUntil = now + this.options.lockoutMs;
      entry.failures = [];
    }
    this.remember(this.entries, key, entry);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  // ---- sign-in (username + source address) -----------------------------------------------------

  private static sourceKey(username: string, ip: string | null) {
    return `login:${username}|${ip ?? '?'}`;
  }

  private static accountKey(username: string) {
    return `account:${username}`;
  }

  /** Whether a sign-in for `username` from `ip` must be refused right now. */
  isSignInLocked(username: string, ip: string | null, now: number): boolean {
    if (this.isLocked(LoginThrottle.sourceKey(username, ip), now)) return true;
    if (!this.isLocked(LoginThrottle.accountKey(username), now)) return false;
    const trustedUntil = this.trusted.get(LoginThrottle.sourceKey(username, ip));
    return !(trustedUntil !== undefined && trustedUntil > now);
  }

  recordSignInFailure(username: string, ip: string | null, now: number): void {
    this.recordFailure(LoginThrottle.sourceKey(username, ip), now);
    this.recordFailure(LoginThrottle.accountKey(username), now, this.accountMax);
  }

  /** Successful sign-in: clear this address's failures and remember it as a known address. */
  recordSignInSuccess(username: string, ip: string | null, now: number): void {
    const key = LoginThrottle.sourceKey(username, ip);
    this.reset(key);
    this.remember(this.trusted, key, now + this.trustMs);
  }

  private remember<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key);
    map.set(key, value);
    if (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }
}
