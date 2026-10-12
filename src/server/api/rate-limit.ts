export interface MutationRateLimitOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export interface MutationRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

interface RateWindow {
  count: number;
  startedAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;
const MAX_TRACKED_KEYS = 100_000;
const MAX_KEY_LENGTH = 256;

export class MutationRateLimiter {
  private readonly windows = new Map<string, RateWindow>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly options: MutationRateLimitOptions) {
    const { limit, windowMs } = options;
    const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Rate limit must be a positive integer.");
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new RangeError("Rate limit window must be a positive number of milliseconds.");
    }
    if (
      !Number.isInteger(maxKeys) ||
      maxKeys < 1 ||
      maxKeys > MAX_TRACKED_KEYS
    ) {
      throw new RangeError(`maxKeys must be an integer from 1 to ${MAX_TRACKED_KEYS}.`);
    }

    this.maxKeys = maxKeys;
    this.now = options.now ?? Date.now;
  }

  get trackedKeyCount(): number {
    return this.windows.size;
  }

  consume(key: string): MutationRateLimitResult {
    if (
      typeof key !== "string" ||
      key.trim() === "" ||
      key.length > MAX_KEY_LENGTH ||
      /[\u0000-\u001F\u007F]/.test(key)
    ) {
      throw new TypeError("Rate limit keys must be nonempty, bounded, and free of control characters.");
    }

    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new RangeError("Rate limit clock must return a finite timestamp.");
    }

    this.removeExpiredWindows(now);
    let window = this.windows.get(key);
    if (window && now >= window.startedAt + this.options.windowMs) {
      window = undefined;
      this.windows.delete(key);
    }

    if (!window) {
      if (this.windows.size >= this.maxKeys) this.evictOldestWindow();
      window = { count: 0, startedAt: now };
    }

    window.count += 1;
    this.windows.delete(key);
    this.windows.set(key, window);

    const resetAt = window.startedAt + this.options.windowMs;
    const allowed = window.count <= this.options.limit;

    return {
      allowed,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - window.count),
      resetAt,
      retryAfterMs: allowed ? 0 : Math.max(1, resetAt - now),
    };
  }

  private removeExpiredWindows(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.startedAt + this.options.windowMs) {
        this.windows.delete(key);
      }
    }
  }

  private evictOldestWindow(): void {
    const oldestKey = this.windows.keys().next().value;
    if (oldestKey !== undefined) this.windows.delete(oldestKey);
  }
}

export const mutationRateLimiter = new MutationRateLimiter({
  limit: 20,
  windowMs: 60_000,
});
