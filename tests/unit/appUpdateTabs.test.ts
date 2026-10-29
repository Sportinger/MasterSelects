import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => logs } }));

import {
  createAppUpdateChecker,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_JITTER_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  type AppBuildIdentity,
} from '../../src/services/appUpdate/appUpdateCheck';
import { readAppUpdateMessage, type BroadcastChannelLike, type LockManagerLike, type TabCoordination } from '../../src/services/appUpdate/appUpdateTabs';

const RUNNING: AppBuildIdentity = { version: '3.3.8', buildId: '2026-10-28T10:00:00.000Z', releaseId: 'masterselects-3.3.8-aaa' };
const NEWER = { schema: 'masterselects-build/v1', version: '3.3.9', buildId: '2026-10-29T10:00:00.000Z', releaseId: 'masterselects-3.3.9-bbb' };
const INTERVAL = UPDATE_CHECK_INTERVAL_MS + UPDATE_CHECK_JITTER_MS / 2;

/** Exclusive lock with a FIFO queue and AbortSignal, like navigator.locks for one lock name. */
class FakeLocks implements LockManagerLike {
  private held = false;
  private queue: Array<() => void> = [];

  request(_name: string, options: { signal?: AbortSignal }, callback: (lock: unknown) => Promise<void>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.held = true;
        void Promise.resolve().then(() => callback({})).then(resolve, reject).finally(() => {
          this.held = false;
          this.queue.shift()?.();
        });
      };
      if (options.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(run);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      });
      if (this.held) this.queue.push(run);
      else run();
    });
  }
}

/** BroadcastChannel: delivers asynchronously to every other open channel, never to the sender. */
class FakeChannel extends EventTarget {
  constructor(private readonly peers: Set<FakeChannel>) { super(); }
  postMessage(data: unknown) {
    for (const peer of this.peers) {
      if (peer === this) continue;
      const copy = structuredClone(data);
      void Promise.resolve().then(() => peer.dispatchEvent(new MessageEvent('message', { data: copy })));
    }
  }
  close() { this.peers.delete(this); }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function browser(answer: () => Promise<Response> = async () => jsonResponse(NEWER)) {
  const clock = { now: 1_000_000 };
  const channels = new Set<FakeChannel>();
  const coordination: TabCoordination = {
    locks: new FakeLocks(),
    openChannel: () => {
      const channel = new FakeChannel(channels);
      channels.add(channel);
      return channel as unknown as BroadcastChannelLike;
    },
  };
  const openTab = (options: { coordinated?: boolean; visible?: boolean } = {}) => {
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => answer());
    const doc = new FakeDocument();
    doc.visibilityState = options.visible === false ? 'hidden' : 'visible';
    const win = new EventTarget();
    const checker = createAppUpdateChecker({
      fetcher: fetcher as unknown as typeof fetch,
      now: () => clock.now,
      random: () => 0.5,
      running: RUNNING,
      isEnabled: () => true,
      doc: doc as unknown as Document,
      win: win as unknown as Window,
      coordination: options.coordinated === false ? null : coordination,
    });
    checker.start();
    return { checker, fetcher, doc, win };
  };
  // Messages and lock grants are delivered before the clock moves on, as they would be in a browser.
  const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
  const advance = async (ms: number) => {
    await settle();
    clock.now += ms;
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  };
  return { openTab, advance };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('update check shared by several tabs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(logs).forEach(spy => spy.mockClear());
  });
  afterEach(() => vi.useRealTimers());

  it('lets only one tab poll and makes every tab glow', async () => {
    const { openTab, advance } = browser();
    const a = openTab();
    await advance(0);
    const b = openTab();
    await advance(0);
    await advance(INTERVAL);
    expect(a.fetcher).toHaveBeenCalledTimes(1);
    expect(b.fetcher).not.toHaveBeenCalled();
    expect(a.checker.getSnapshot()).toEqual({ available: true, version: '3.3.9' });
    expect(b.checker.getSnapshot()).toEqual({ available: true, version: '3.3.9' });

    await advance(INTERVAL * 3);
    expect(a.fetcher).toHaveBeenCalledTimes(4);
    expect(b.fetcher).not.toHaveBeenCalled();
  });

  it('checks for a tab that comes back, at most once a minute across all tabs', async () => {
    const { openTab, advance } = browser();
    const a = openTab();
    await advance(0);
    const b = openTab();
    await advance(UPDATE_CHECK_MIN_GAP_MS);

    b.doc.setVisibility('hidden');
    b.doc.setVisibility('visible');
    await advance(0);
    expect(a.fetcher).toHaveBeenCalledTimes(1);
    expect(b.fetcher).not.toHaveBeenCalled();
    expect(b.checker.getSnapshot().available).toBe(true);

    // Coming back again within the minute, from either tab, does not check again.
    b.doc.setVisibility('hidden');
    b.doc.setVisibility('visible');
    b.win.dispatchEvent(new Event('online'));
    await advance(1000);
    expect(a.fetcher.mock.calls.length + b.fetcher.mock.calls.length).toBe(1);

    await advance(UPDATE_CHECK_MIN_GAP_MS);
    b.doc.setVisibility('hidden');
    b.doc.setVisibility('visible');
    await advance(0);
    expect(a.fetcher).toHaveBeenCalledTimes(2);
  });

  it('hands polling to the next visible tab when the polling tab is hidden or closed', async () => {
    const { openTab, advance } = browser();
    const a = openTab();
    await advance(0);
    const b = openTab();
    await advance(0);

    a.doc.setVisibility('hidden');
    await advance(0);
    await advance(INTERVAL);
    expect(a.fetcher).not.toHaveBeenCalled();
    expect(b.fetcher).toHaveBeenCalledTimes(1);
    expect(a.checker.getSnapshot().available).toBe(true);

    // A comes back while B polls: it asks B instead of polling itself.
    a.doc.setVisibility('visible');
    await advance(UPDATE_CHECK_MIN_GAP_MS);
    expect(a.fetcher).not.toHaveBeenCalled();

    // B is closed: A takes over and keeps B's rhythm.
    b.checker.stop();
    await advance(0);
    expect(a.fetcher).not.toHaveBeenCalled();
    await advance(INTERVAL);
    expect(a.fetcher).toHaveBeenCalledTimes(1);
    expect(b.fetcher).toHaveBeenCalledTimes(1);
  });

  it('checks right away when the only tab comes back after a while', async () => {
    const { openTab, advance } = browser();
    const a = openTab();
    await advance(0);
    a.doc.setVisibility('hidden');
    await advance(INTERVAL * 4);
    expect(a.fetcher).not.toHaveBeenCalled();
    a.doc.setVisibility('visible');
    await advance(0);
    expect(a.fetcher).toHaveBeenCalledTimes(1);
  });

  it('tells a tab opened later the last answer without polling again', async () => {
    const { openTab, advance } = browser();
    const a = openTab();
    await advance(0);
    await advance(INTERVAL);
    const c = openTab();
    await advance(0);
    expect(c.checker.getSnapshot()).toEqual({ available: true, version: '3.3.9' });
    expect(c.fetcher).not.toHaveBeenCalled();
    expect(a.fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps one check per tab without Web Locks or BroadcastChannel', async () => {
    const { openTab, advance } = browser();
    const a = openTab({ coordinated: false });
    const b = openTab({ coordinated: false });
    await advance(INTERVAL);
    expect(a.fetcher).toHaveBeenCalledTimes(1);
    expect(b.fetcher).toHaveBeenCalledTimes(1);
    expect(b.checker.getSnapshot().available).toBe(true);
  });

  it('ignores channel messages it does not understand', () => {
    expect(readAppUpdateMessage({ v: 2, type: 'result', checkedAt: 1, build: null })).toBeNull();
    expect(readAppUpdateMessage({ v: 1, type: 'result', checkedAt: 'soon', build: null })).toBeNull();
    expect(readAppUpdateMessage({ v: 1, type: 'result', checkedAt: 1, build: { version: 3 } })).toBeNull();
    expect(readAppUpdateMessage({ v: 1, type: 'check', reason: 'online' })).toEqual({ v: 1, type: 'check', reason: 'online' });
  });
});
