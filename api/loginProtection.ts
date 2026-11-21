// ==================== LOGIN LOCKOUT & RATE LIMITING ====================
// Per-account login lockout (owner-specified policy):
//   3 consecutive failed attempts -> lock 15 seconds
//   next 3 failed attempts        -> lock 30 seconds
//   next 3 failed attempts        -> lock 60 seconds
//   every further round of 3      -> lock 60 seconds (cap)
//   any successful login          -> counter and escalation fully reset
// Plus small fixed-window IP rate limiters (login endpoints + global API).
// All state is in-memory and bounded (MAX_ENTRIES with oldest-first eviction).

export interface LockoutCheck {
  locked: boolean;
  retryAfterSeconds: number;
}

export interface LockoutFailureResult extends LockoutCheck {
  fails: number;
  justLocked: boolean;
}

interface LockoutEntry {
  fails: number;        // consecutive failed attempts, total since last success
  lockedUntil: number;  // epoch ms; 0 when not locked
  touched: number;      // last activity, for eviction
}

const DEFAULT_LOCK_DURATIONS_MS = [15_000, 30_000, 60_000];
const MAX_ENTRIES = 10_000;

export function parseLockDurationsEnv(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_LOCK_DURATIONS_MS.slice();
  const parts = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length > 0 ? parts : DEFAULT_LOCK_DURATIONS_MS.slice();
}

export function createLoginLockout(durationsMs: number[] = DEFAULT_LOCK_DURATIONS_MS, nowFn: () => number = Date.now) {
  const entries = new Map<string, LockoutEntry>();
  const durations = durationsMs.length > 0 ? durationsMs.slice() : DEFAULT_LOCK_DURATIONS_MS.slice();

  function evictIfNeeded(now: number) {
    if (entries.size <= MAX_ENTRIES) return;
    // First pass: drop expired, inactive entries
    for (const [k, e] of entries) {
      if (e.lockedUntil <= now && now - e.touched > 60 * 60 * 1000) entries.delete(k);
    }
    // Second pass: still too big -> evict oldest-touched until under the cap
    while (entries.size > MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestTouched = Infinity;
      for (const [k, e] of entries) {
        if (e.touched < oldestTouched) {
          oldestTouched = e.touched;
          oldestKey = k;
        }
      }
      if (oldestKey === null) break;
      entries.delete(oldestKey);
    }
  }

  function check(key: string): LockoutCheck {
    const now = nowFn();
    const e = entries.get(key);
    if (!e) return { locked: false, retryAfterSeconds: 0 };
    if (e.lockedUntil > now) {
      return { locked: true, retryAfterSeconds: Math.ceil((e.lockedUntil - now) / 1000) };
    }
    return { locked: false, retryAfterSeconds: 0 };
  }

  function recordFailure(key: string): LockoutFailureResult {
    const now = nowFn();
    evictIfNeeded(now);
    let e = entries.get(key);
    if (!e) {
      e = { fails: 0, lockedUntil: 0, touched: now };
      entries.set(key, e);
    }
    e.touched = now;
    if (e.lockedUntil > now) {
      // Already locked; do not extend or recount, the request never reaches password checking.
      return { locked: true, retryAfterSeconds: Math.ceil((e.lockedUntil - now) / 1000), fails: e.fails, justLocked: false };
    }
    e.fails += 1;
    if (e.fails % 3 === 0) {
      const round = Math.floor(e.fails / 3); // 1st lock, 2nd lock, 3rd lock, ...
      const idx = Math.min(round - 1, durations.length - 1);
      const dur = durations[idx];
      e.lockedUntil = now + dur;
      return { locked: true, retryAfterSeconds: Math.ceil(dur / 1000), fails: e.fails, justLocked: true };
    }
    return { locked: false, retryAfterSeconds: 0, fails: e.fails, justLocked: false };
  }

  function recordSuccess(key: string): void {
    entries.delete(key);
  }

  return { check, recordFailure, recordSuccess };
}

// ---- Fixed-window per-IP rate limiter ----
interface RateEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function createRateLimiter(options: RateLimitOptions, nowFn: () => number = Date.now) {
  const hits = new Map<string, RateEntry>();

  function isLimited(key: string): boolean {
    const now = nowFn();
    let e = hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 1, resetAt: now + options.windowMs };
      hits.set(key, e);
    } else {
      e.count++;
    }
    if (hits.size > MAX_ENTRIES) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
      if (hits.size > MAX_ENTRIES * 2) hits.clear();
    }
    return e.count > options.max;
  }

  return { isLimited };
}

export function getClientIp(req: any): string {
  const fwd = req?.headers?.['x-forwarded-for'];
  const raw = (typeof fwd === 'string' && fwd) || req?.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim() || 'unknown';
}
