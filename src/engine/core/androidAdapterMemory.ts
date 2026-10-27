// Per-device memory of how the Android WebGPU adapter request went last time.
//
// Field data (gpu_init_outcome, Tensor G5 / PowerVR): the core adapter request on some Android
// GPUs never settles; the editor waits the full request deadline and then fails with
// 'adapter_timeout', on every start. A pending request must not be followed by a second request
// in the same start (Chrome serialises them), so the only way to try another path is the next
// start. This module remembers the outcome in one small localStorage key and turns it into the
// request order for the next start. Android only: desktop never reads or writes it.

/** Small, versioned key; absent or unreadable means "no memory" (default order). */
export const ANDROID_ADAPTER_MEMORY_KEY = 'ms.gpu.androidAdapter';

/** Default request deadline (also used by gpuDeviceRequest when no deadline is passed). */
export const DEFAULT_GPU_REQUEST_TIMEOUT_MS = 15_000;
/** Deadline once both adapter paths have stalled on this device: fail fast instead of 15 s. */
export const STALLED_DEVICE_TIMEOUT_MS = 6_000;

export type AndroidAdapterPath = 'core' | 'compatibility';
export type AndroidAdapterOutcome = 'ok' | 'timeout' | 'null';

export interface AndroidAdapterMemory {
  v: 1;
  /** Browser identity the memory belongs to; a browser update starts fresh. */
  browser: string;
  coreTimeouts: number;
  compatibilityTimeouts: number;
  /** Last path that produced an adapter, null when none has worked yet. */
  worked: AndroidAdapterPath | null;
  /** Epoch ms of the last update. */
  at: number;
}

export interface AndroidAdapterPlan {
  order: readonly [AndroidAdapterPath, AndroidAdapterPath];
  timeoutMs: number;
  /** Why this order was chosen; logged and attached to diagnostics. */
  reason: 'default' | 'compatibility-worked' | 'core-worked' | 'core-timed-out' | 'both-timed-out' | 'browser-changed';
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, or null where it is missing or throws (private mode, blocked site data). */
export function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 'chrome-146', 'samsung-27', ... from the user agent; 'unknown' when nothing matches. */
export function browserIdentity(userAgent: string): string {
  const match = /(SamsungBrowser|EdgA|Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(userAgent);
  return match ? `${match[1].toLowerCase()}-${match[2]}` : 'unknown';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(99, Math.floor(value)) : 0;
}

export function readAndroidAdapterMemory(storage: StorageLike | null = safeLocalStorage()): AndroidAdapterMemory | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ANDROID_ADAPTER_MEMORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AndroidAdapterMemory> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.browser !== 'string') return null;
    return {
      v: 1,
      browser: parsed.browser,
      coreTimeouts: count(parsed.coreTimeouts),
      compatibilityTimeouts: count(parsed.compatibilityTimeouts),
      worked: parsed.worked === 'core' || parsed.worked === 'compatibility' ? parsed.worked : null,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}

/** The request order and deadline for this start. */
export function planAndroidAdapterRequests(memory: AndroidAdapterMemory | null, browser: string): AndroidAdapterPlan {
  const standard: AndroidAdapterPlan = { order: ['core', 'compatibility'], timeoutMs: DEFAULT_GPU_REQUEST_TIMEOUT_MS, reason: 'default' };
  if (!memory) return standard;
  if (memory.browser !== browser) return { ...standard, reason: 'browser-changed' };
  if (memory.worked === 'compatibility') {
    return { order: ['compatibility', 'core'], timeoutMs: DEFAULT_GPU_REQUEST_TIMEOUT_MS, reason: 'compatibility-worked' };
  }
  if (memory.coreTimeouts > 0 && memory.compatibilityTimeouts > 0) {
    // Both paths stalled before: keep the normal order but stop waiting the full deadline.
    return { order: ['core', 'compatibility'], timeoutMs: STALLED_DEVICE_TIMEOUT_MS, reason: 'both-timed-out' };
  }
  if (memory.coreTimeouts > 0) {
    return { order: ['compatibility', 'core'], timeoutMs: DEFAULT_GPU_REQUEST_TIMEOUT_MS, reason: 'core-timed-out' };
  }
  if (memory.worked === 'core') return { ...standard, reason: 'core-worked' };
  return standard;
}

/**
 * Folds one adapter request outcome into the memory and writes it. 'ok' clears the timeout
 * counters (the device works); 'timeout' counts against that path; 'null' changes nothing
 * because the next path was already tried in the same start. Returns the stored memory, or
 * null when nothing was written (no storage, or a write that threw).
 */
export function recordAndroidAdapterOutcome(
  path: AndroidAdapterPath,
  outcome: AndroidAdapterOutcome,
  browser: string,
  storage: StorageLike | null = safeLocalStorage(),
  now: number = Date.now(),
): AndroidAdapterMemory | null {
  if (!storage || outcome === 'null') return null;
  const previous = readAndroidAdapterMemory(storage);
  const base: AndroidAdapterMemory = previous && previous.browser === browser
    ? previous
    : { v: 1, browser, coreTimeouts: 0, compatibilityTimeouts: 0, worked: null, at: now };
  const next: AndroidAdapterMemory = outcome === 'ok'
    ? { ...base, coreTimeouts: 0, compatibilityTimeouts: 0, worked: path, at: now }
    : {
        ...base,
        coreTimeouts: base.coreTimeouts + (path === 'core' ? 1 : 0),
        compatibilityTimeouts: base.compatibilityTimeouts + (path === 'compatibility' ? 1 : 0),
        worked: base.worked === path ? null : base.worked,
        at: now,
      };
  try {
    storage.setItem(ANDROID_ADAPTER_MEMORY_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}
