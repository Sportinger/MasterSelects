// Notices a deploy while the editor stays open: compares the running build with the server's
// /build-info.json (written by vite.config.ts) and publishes "a new version is available" for the
// workspace bar brand and the phone top bar. It checks every few minutes with jitter, and when the tab
// comes back into view or the browser goes online again; a hidden tab never polls. With several tabs open,
// one visible tab polls for all of them (appUpdateTabs.ts). The dev server serves no build-info, so the
// check stays off there unless localStorage `ms.updateCheck.enabled` is 'true'.

import { APP_BUILD_ID, APP_RELEASE_ID } from '../appBuild';
import { Logger } from '../logger';
import { APP_VERSION } from '../../version';
import {
  createTabLeadership,
  detectTabCoordination,
  readAppUpdateMessage,
  type AppUpdateMessage,
  type BroadcastChannelLike,
  type TabCoordination,
  type TabLeadership,
} from './appUpdateTabs';

const log = Logger.create('AppUpdateCheck');

export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
export const UPDATE_CHECK_JITTER_MS = 60_000;
/** Tab returns and online events check at most this often; a missed interval check always runs. */
export const UPDATE_CHECK_MIN_GAP_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
export const UPDATE_CHECK_FLAG_KEY = 'ms.updateCheck.enabled';
/** How long a tab return waits for a polling tab to take it over before it is dropped. */
const RETURN_HANDOVER_MS = 10_000;

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
  /** Web Locks and BroadcastChannel shared with the other tabs (appUpdateTabs.ts); null: this tab checks alone. */
  coordination?: TabCoordination | null;
}

export interface AppUpdateChecker {
  start(): void;
  stop(): void;
  /** One check now, unless one is already running; resolves when it settled. */
  check(reason: string): Promise<void>;
  getSnapshot(): AppUpdateSnapshot;
  subscribe(listener: () => void): () => void;
}

type ResultMessage = Extract<AppUpdateMessage, { type: 'result' }>;

export function createAppUpdateChecker(deps: AppUpdateCheckerDeps = {}): AppUpdateChecker {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const running = deps.running ?? RUNNING_BUILD;
  const isEnabled = deps.isEnabled ?? (() => isAppUpdateCheckEnabled());
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;
  const coordination = deps.coordination === undefined ? detectTabCoordination() : deps.coordination;
  const listeners = new Set<() => void>();
  let snapshot: AppUpdateSnapshot = { available: false, version: null };
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let missedWhileHidden = false;
  /** Latest check of any tab: tab returns and other tabs' requests keep the one-minute gap across tabs. */
  let lastCheckAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let failing = false;
  let channel: BroadcastChannelLike | null = null;
  let lastResult: ResultMessage | null = null;
  /** A tab return or reconnect no polling tab has answered yet; this tab handles it when it takes over. */
  let returnPending: { reason: string; at: number } | null = null;
  let leadership: TabLeadership | null = null;

  const visible = () => doc.visibilityState !== 'hidden';
  /** Only the leader polls; without coordination every tab does. */
  const polls = () => !leadership || leadership.leader;

  const publish = (next: AppUpdateSnapshot) => {
    if (next.available === snapshot.available && next.version === snapshot.version) return;
    snapshot = next;
    if (next.available) log.info(`Version ${next.version} is available (running ${running.version})`);
    for (const listener of [...listeners]) listener();
  };

  const publishComparison = (comparison: AppBuildComparison) => {
    if (comparison.kind === 'unknown') return;
    publish(comparison.kind === 'available' ? { available: true, version: comparison.version } : { available: false, version: null });
  };

  const post = (message: AppUpdateMessage) => {
    try { channel?.postMessage(message); } catch (error) { log.debug('Telling the other tabs failed', error); }
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  // Jitter spreads the checks of every browser after a deploy.
  const nextDelay = () => UPDATE_CHECK_INTERVAL_MS + Math.round(random() * UPDATE_CHECK_JITTER_MS);

  const schedule = (delay = nextDelay()) => {
    clearTimer();
    timer = setTimeout(onTimer, Math.max(0, delay));
  };

  /** A tab taking over keeps the rhythm of the tab before it. */
  const scheduleAfterLastCheck = () => {
    schedule(Number.isFinite(lastCheckAt) ? lastCheckAt + nextDelay() - now() : nextDelay());
  };

  function onTimer() {
    timer = null;
    if (!polls()) return;
    if (!visible()) { missedWhileHidden = true; return; }
    void check('interval');
  }

  const runCheck = async (reason: string) => {
    const checkedAt = now();
    lastCheckAt = checkedAt;
    try {
      const served = await fetchServerBuildInfo(fetcher, checkedAt);
      const comparison = compareAppBuild(running, served);
      if (comparison.kind === 'unknown') throw new Error(comparison.reason);
      if (failing) log.info('Update check works again');
      failing = false;
      publishComparison(comparison);
      lastResult = { v: 1, type: 'result', checkedAt, build: readBuildIdentity(served) };
      post(lastResult);
    } catch (error) {
      // Offline or a server without build info: say so once per failure streak, keep the last answer.
      if (!failing) log.warn(`Update check failed (${reason}); retrying quietly`, error instanceof Error ? error.message : error);
      else log.debug('Update check failed again', error);
      failing = true;
      post({ v: 1, type: 'result', checkedAt, build: null });
    } finally {
      if (started && polls()) schedule();
    }
  };

  function check(reason: string): Promise<void> {
    if (!isEnabled()) {
      if (started && timer === null && polls()) schedule();
      return Promise.resolve();
    }
    missedWhileHidden = false;
    inFlight ??= runCheck(reason).finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Checks unless a check (of any tab) ran within the last minute; true when it checks. */
  const checkIfDue = (reason: string): boolean => {
    // A returning connection retries a failed check at once; everything else keeps the minimum gap.
    const retryAfterFailure = failing && reason === 'online';
    if (!missedWhileHidden && !retryAfterFailure && now() - lastCheckAt < UPDATE_CHECK_MIN_GAP_MS) return false;
    void check(reason);
    return true;
  };

  const onReturn = (reason: string) => {
    if (!visible()) return;
    if (polls()) { checkIfDue(reason); return; }
    // Another tab polls (it decides about the gap), or this tab is about to take over.
    returnPending = { reason, at: now() };
    leadership?.request();
    post({ v: 1, type: 'check', reason });
  };

  function onLeaderChange(leader: boolean) {
    if (!leader) { clearTimer(); return; }
    log.debug('This tab checks for updates for every open tab');
    const pending = returnPending;
    returnPending = null;
    // Only a fresh request: one the previous polling tab already answered was cleared by its reply.
    if (pending && now() - pending.at <= RETURN_HANDOVER_MS) checkIfDue(pending.reason);
    if (timer === null && !inFlight) scheduleAfterLastCheck();
  }

  const onMessage = (event: MessageEvent) => {
    const message = readAppUpdateMessage(event.data);
    if (!message) return;
    if (message.type === 'result') {
      lastCheckAt = Math.max(lastCheckAt, message.checkedAt);
      returnPending = null;
      failing = message.build === null;
      if (message.build) {
        lastResult = message;
        publishComparison(compareAppBuild(running, message.build));
      }
      // Two tabs polled during a handover: the leader goes on from the newest check.
      if (leadership?.leader && !inFlight) scheduleAfterLastCheck();
      return;
    }
    if (!leadership?.leader) return;
    // A tab that is not due for a check still gets the last answer (it may have missed it while frozen).
    if (message.type === 'hello' || !checkIfDue(message.reason)) {
      if (lastResult) post(lastResult);
    }
  };

  const onVisibility = () => {
    // A hidden tab never polls: it hands the lock to the next visible tab.
    if (!visible()) { leadership?.resign(); return; }
    onReturn('tab visible');
  };
  const onOnline = () => onReturn('online');

  const joinOtherTabs = (shared: TabCoordination): boolean => {
    try {
      channel = shared.openChannel();
      channel.addEventListener('message', onMessage);
    } catch (error) {
      log.warn('Tabs cannot share the update check; this tab checks alone', error instanceof Error ? error.message : error);
      channel = null;
      return false;
    }
    leadership = createTabLeadership(shared.locks, onLeaderChange);
    post({ v: 1, type: 'hello' });
    if (visible()) leadership.request();
    return true;
  };

  return {
    start() {
      if (started) return;
      started = true;
      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('online', onOnline);
      if (!coordination || !joinOtherTabs(coordination)) schedule();
    },
    stop() {
      if (!started) return;
      started = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('online', onOnline);
      leadership?.resign();
      leadership = null;
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      channel = null;
      returnPending = null;
      clearTimer();
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
