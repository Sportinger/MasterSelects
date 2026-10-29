// Several open MasterSelects tabs of one browser share one update check: the visible tab holding the
// `masterselects-app-update-leader` Web Lock polls /build-info.json and announces each answer on the
// `masterselects-app-update` BroadcastChannel; the others only listen. A tab asks for the lock only while it
// is visible and gives it up when it is hidden, so a closed, hidden or frozen leader hands over to the next
// visible tab waiting in the lock queue (no stealing). Browsers without Web Locks or BroadcastChannel keep
// one independent check per tab (appUpdateCheck.ts).

export const APP_UPDATE_CHANNEL = 'masterselects-app-update';
export const APP_UPDATE_LEADER_LOCK = 'masterselects-app-update-leader';

export interface LockManagerLike {
  request(name: string, options: { signal?: AbortSignal }, callback: (lock: unknown) => Promise<void>): Promise<unknown>;
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface TabCoordination {
  locks: LockManagerLike;
  openChannel(): BroadcastChannelLike;
}

/** Served build as announced by the polling tab; every tab compares it with the build it runs itself. */
export interface AnnouncedBuild { version: string | null; buildId: string | null; releaseId: string | null }

/**
 * `result`: the leader's answer (`build` null when the check failed). `check`: a tab came back or went
 * online and asks the leader to check (the leader keeps the one-minute gap). `hello`: a joining tab asks
 * for the last answer.
 */
export type AppUpdateMessage =
  | { v: 1; type: 'result'; checkedAt: number; build: AnnouncedBuild | null }
  | { v: 1; type: 'check'; reason: string }
  | { v: 1; type: 'hello' };

const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';

/** Messages come from other tabs, possibly of another build: anything unexpected is ignored. */
export function readAppUpdateMessage(data: unknown): AppUpdateMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.v !== 1) return null;
  if (message.type === 'hello') return { v: 1, type: 'hello' };
  if (message.type === 'check') return { v: 1, type: 'check', reason: typeof message.reason === 'string' ? message.reason : 'other tab' };
  if (message.type !== 'result' || typeof message.checkedAt !== 'number' || !Number.isFinite(message.checkedAt)) return null;
  const build = message.build as Record<string, unknown> | null;
  if (build === null) return { v: 1, type: 'result', checkedAt: message.checkedAt, build: null };
  if (!build || typeof build !== 'object' || !nullableText(build.version) || !nullableText(build.buildId) || !nullableText(build.releaseId)) return null;
  return { v: 1, type: 'result', checkedAt: message.checkedAt, build: { version: build.version, buildId: build.buildId, releaseId: build.releaseId } };
}

/** Web Locks and BroadcastChannel of this browser, or null when either is missing. */
export function detectTabCoordination(): TabCoordination | null {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks as LockManagerLike | undefined;
  if (typeof locks?.request !== 'function' || typeof globalThis.BroadcastChannel !== 'function') return null;
  return { locks, openChannel: () => new BroadcastChannel(APP_UPDATE_CHANNEL) };
}

export interface TabLeadership {
  readonly leader: boolean;
  /** Queues for the lock unless this tab holds it or already waits for it. */
  request(): void;
  /** Leaves the queue, or releases the lock so the next waiting tab takes over. */
  resign(): void;
}

export function createTabLeadership(locks: LockManagerLike, onChange: (leader: boolean) => void): TabLeadership {
  let waiting: AbortController | null = null;
  let release: (() => void) | null = null;
  return {
    get leader() { return release !== null; },
    request() {
      if (waiting || release) return;
      const controller = new AbortController();
      waiting = controller;
      locks.request(APP_UPDATE_LEADER_LOCK, { signal: controller.signal }, () => new Promise<void>((resolve) => {
        if (waiting !== controller) { resolve(); return; }
        waiting = null;
        release = resolve;
        onChange(true);
      })).catch(() => {
        // An aborted request: this tab went hidden or stopped before its turn.
      }).finally(() => {
        if (waiting === controller) waiting = null;
      });
    },
    resign() {
      waiting?.abort();
      waiting = null;
      if (!release) return;
      const done = release;
      release = null;
      done();
      onChange(false);
    },
  };
}
