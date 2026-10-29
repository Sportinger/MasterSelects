// Notices a deploy while the editor stays open: compares the running build with the server's
// /build-info.json (written by vite.config.ts) and publishes "a new version is available" for the
// workspace bar brand and the phone top bar. It checks every few minutes with jitter, and when the tab
// comes back into view or the browser goes online again; a hidden tab never polls. The dev server serves
// no build-info, so the check stays off there unless localStorage `ms.updateCheck.enabled` is 'true'.

import { APP_BUILD_ID, APP_RELEASE_ID } from '../appBuild';
import { Logger } from '../logger';
import { APP_VERSION } from '../../version';

const log = Logger.create('AppUpdateCheck');

export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
export const UPDATE_CHECK_JITTER_MS = 60_000;
/** Tab returns and online events check at most this often; a missed interval check always runs. */
export const UPDATE_CHECK_MIN_GAP_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
export const UPDATE_CHECK_FLAG_KEY = 'ms.updateCheck.enabled';

export interface AppBuildIdentity {
  version: string | null;
  buildId: string | null;
  releaseId: string | null;
}

export type AppBuildComparison =
  | { kind: 'current' }
  | { kind: 'available'; version: string; key: string }
  | { kind: 'unknown'; reason: string };

export const RUNNING_BUILD: AppBuildIdentity = { version: APP_VERSION, buildId: APP_BUILD_ID, releaseId: APP_RELEASE_ID };

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * A clean release is identified by its release id (version + commit), so a second deploy of the same
 * commit is not an update; local builds without one fall back to their build timestamp.
 */
function buildKey(build: AppBuildIdentity): string | null {
  return build.releaseId ?? (build.buildId && build.buildId !== 'development' ? build.buildId : null);
}

export function readBuildIdentity(value: unknown): AppBuildIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return { version: text(record.version), buildId: text(record.buildId), releaseId: text(record.releaseId) };
}

/** Pure comparison of the running build with the server's build-info.json content. */
export function compareAppBuild(running: AppBuildIdentity, server: unknown): AppBuildComparison {
  const served = readBuildIdentity(server);
  const servedKey = served ? buildKey(served) : null;
  if (!served || !servedKey) return { kind: 'unknown', reason: 'The server has no build info.' };
  if (servedKey === buildKey(running)) return { kind: 'current' };
  return { kind: 'available', version: served.version ?? 'newer', key: servedKey };
}

/** Fetches the server's build info past every cache; resolves null when the answer is not build info, rejects offline. */
export async function fetchServerBuildInfo(fetcher: typeof fetch, now: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(`/build-info.json?check=${now}`, {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
    });
    // A missing file, or index.html from the dev server or an SPA fallback, is no build info.
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export function isAppUpdateCheckEnabled(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): boolean {
  let flag: string | null = null;
  try { flag = storage?.getItem(UPDATE_CHECK_FLAG_KEY) ?? null; } catch { /* storage blocked */ }
  return import.meta.env.DEV ? flag === 'true' : flag !== 'false';
}

function safeLocalStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export interface AppUpdateSnapshot {
  /** The served build differs from the running one. */
  available: boolean;
  /** Version of the served build while `available`. */
  version: string | null;
}

export interface AppUpdateCheckerDeps {
  fetcher?: typeof fetch;
  now?: () => number;
  random?: () => number;
  running?: AppBuildIdentity;
  isEnabled?: () => boolean;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface AppUpdateChecker {
  start(): void;
  stop(): void;
  /** One check now, unless one is already running; resolves when it settled. */
  check(reason: string): Promise<void>;
  getSnapshot(): AppUpdateSnapshot;
  subscribe(listener: () => void): () => void;
}

export function createAppUpdateChecker(deps: AppUpdateCheckerDeps = {}): AppUpdateChecker {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const running = deps.running ?? RUNNING_BUILD;
  const isEnabled = deps.isEnabled ?? (() => isAppUpdateCheckEnabled());
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;
  const listeners = new Set<() => void>();
  let snapshot: AppUpdateSnapshot = { available: false, version: null };
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let missedWhileHidden = false;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let failing = false;

  const publish = (next: AppUpdateSnapshot) => {
    if (next.available === snapshot.available && next.version === snapshot.version) return;
    snapshot = next;
    if (next.available) log.info(`Version ${next.version} is available (running ${running.version})`);
    for (const listener of [...listeners]) listener();
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    // Jitter spreads the checks of every open tab after a deploy.
    timer = setTimeout(onTimer, UPDATE_CHECK_INTERVAL_MS + Math.round(random() * UPDATE_CHECK_JITTER_MS));
  };

  const onTimer = () => {
    timer = null;
    if (doc.visibilityState === 'hidden') { missedWhileHidden = true; return; }
    void check('interval');
  };

  const runCheck = async (reason: string) => {
    lastAttemptAt = now();
    try {
      const comparison = compareAppBuild(running, await fetchServerBuildInfo(fetcher, lastAttemptAt));
      if (comparison.kind === 'unknown') throw new Error(comparison.reason);
      if (failing) log.info('Update check works again');
      failing = false;
      publish(comparison.kind === 'available' ? { available: true, version: comparison.version } : { available: false, version: null });
    } catch (error) {
      // Offline or a server without build info: say so once per failure streak, keep the last answer.
      if (!failing) log.warn(`Update check failed (${reason}); retrying quietly`, error instanceof Error ? error.message : error);
      else log.debug('Update check failed again', error);
      failing = true;
    } finally {
      if (started) schedule();
    }
  };

  function check(reason: string): Promise<void> {
    if (!isEnabled()) {
      if (started && timer === null) schedule();
      return Promise.resolve();
    }
    missedWhileHidden = false;
    inFlight ??= runCheck(reason).finally(() => { inFlight = null; });
    return inFlight;
  }

  const onReturn = (reason: string) => {
    if (doc.visibilityState === 'hidden') return;
    // A returning connection retries a failed check at once; everything else keeps the minimum gap.
    const retryAfterFailure = failing && reason === 'online';
    if (missedWhileHidden || retryAfterFailure || now() - lastAttemptAt >= UPDATE_CHECK_MIN_GAP_MS) void check(reason);
  };
  const onVisibility = () => onReturn('tab visible');
  const onOnline = () => onReturn('online');

  return {
    start() {
      if (started) return;
      started = true;
      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('online', onOnline);
      schedule();
    },
    stop() {
      if (!started) return;
      started = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('online', onOnline);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    check,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

let sharedChecker: AppUpdateChecker | null = null;
let retainCount = 0;

export function getAppUpdateChecker(): AppUpdateChecker {
  sharedChecker ??= createAppUpdateChecker();
  return sharedChecker;
}

/** Keeps the shared checker running while at least one surface shows its state. */
export function retainAppUpdateChecker(): () => void {
  const checker = getAppUpdateChecker();
  retainCount += 1;
  if (retainCount === 1) checker.start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    retainCount -= 1;
    if (retainCount === 0) checker.stop();
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => { sharedChecker?.stop(); });
}
