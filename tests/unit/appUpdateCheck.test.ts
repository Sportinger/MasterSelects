import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => logs } }));

import {
  compareAppBuild,
  createAppUpdateChecker,
  isAppUpdateCheckEnabled,
  UPDATE_CHECK_FLAG_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_JITTER_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  type AppBuildIdentity,
} from '../../src/services/appUpdate/appUpdateCheck';

const RUNNING: AppBuildIdentity = { version: '3.3.8', buildId: '2026-10-28T10:00:00.000Z', releaseId: 'masterselects-3.3.8-aaa' };
const SAME = { schema: 'masterselects-build/v1', version: '3.3.8', buildId: '2026-10-29T09:00:00.000Z', releaseId: 'masterselects-3.3.8-aaa' };
const NEWER = { schema: 'masterselects-build/v1', version: '3.3.9', buildId: '2026-10-29T10:00:00.000Z', releaseId: 'masterselects-3.3.9-bbb' };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function setup(answer: () => Promise<Response>) {
  const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => answer());
  const doc = new FakeDocument();
  const win = new EventTarget();
  let clock = 1_000_000;
  const checker = createAppUpdateChecker({
    fetcher: fetcher as unknown as typeof fetch,
    now: () => clock,
    random: () => 0.5,
    running: RUNNING,
    isEnabled: () => true,
    doc: doc as unknown as Document,
    win: win as unknown as Window,
    // One tab on its own (the fallback without Web Locks or BroadcastChannel); appUpdateTabs.test.ts covers several.
    coordination: null,
  });
  const advance = async (ms: number) => { clock += ms; await vi.advanceTimersByTimeAsync(ms); };
  return { fetcher, doc, win, checker, advance };
}

describe('compareAppBuild', () => {
  it('treats the same release as current even when it was deployed again', () => {
    expect(compareAppBuild(RUNNING, SAME)).toEqual({ kind: 'current' });
  });

  it('reports another release as available with its version', () => {
    expect(compareAppBuild(RUNNING, NEWER)).toEqual({ kind: 'available', version: '3.3.9', key: 'masterselects-3.3.9-bbb' });
  });

  it('compares local builds without a release id by their build id', () => {
    const local = { version: '3.3.8', buildId: 'b1', releaseId: null };
    expect(compareAppBuild(local, { version: '3.3.8', buildId: 'b1' }).kind).toBe('current');
    expect(compareAppBuild(local, { version: '3.3.8', buildId: 'b2' }).kind).toBe('available');
  });

  it('never claims an update from something that is not build info', () => {
    expect(compareAppBuild(RUNNING, null).kind).toBe('unknown');
    expect(compareAppBuild(RUNNING, '<!doctype html>').kind).toBe('unknown');
    expect(compareAppBuild(RUNNING, { version: '3.3.9', buildId: 'development', releaseId: null }).kind).toBe('unknown');
  });
});

describe('app update checker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(logs).forEach(spy => spy.mockClear());
  });
  afterEach(() => vi.useRealTimers());

  it('stays quiet while the server serves the running release', async () => {
    const { checker, fetcher } = setup(async () => jsonResponse(SAME));
    const listener = vi.fn();
    checker.subscribe(listener);
    await checker.check('test');
    expect(checker.getSnapshot()).toEqual({ available: false, version: null });
    expect(listener).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/^\/build-info\.json\?check=\d+$/);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
  });

  it('publishes a newer release once', async () => {
    const { checker } = setup(async () => jsonResponse(NEWER));
    const listener = vi.fn();
    checker.subscribe(listener);
    await checker.check('test');
    await checker.check('again');
    expect(checker.getSnapshot()).toEqual({ available: true, version: '3.3.9' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores an HTML answer (dev server, SPA fallback)', async () => {
    const { checker } = setup(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await checker.check('test');
    expect(checker.getSnapshot().available).toBe(false);
  });

  it('logs an offline streak once and keeps an update it already found', async () => {
    let online = true;
    const { checker } = setup(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return jsonResponse(NEWER);
    });
    await checker.check('first');
    online = false;
    await checker.check('offline 1');
    await checker.check('offline 2');
    await checker.check('offline 3');
    expect(checker.getSnapshot()).toEqual({ available: true, version: '3.3.9' });
    expect(logs.warn).toHaveBeenCalledTimes(1);
    online = true;
    await checker.check('back');
    expect(logs.info).toHaveBeenCalledWith('Update check works again');
  });

  it('polls on its interval with jitter and only while the tab is visible', async () => {
    const { checker, fetcher, doc, advance } = setup(async () => jsonResponse(SAME));
    checker.start();
    const interval = UPDATE_CHECK_INTERVAL_MS + UPDATE_CHECK_JITTER_MS / 2;
    await advance(interval - 1);
    expect(fetcher).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    doc.visibilityState = 'hidden';
    await advance(interval * 3);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Returning to the tab runs the check it missed, right away.
    doc.setVisibility('visible');
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    checker.stop();
  });

  it('checks when the tab comes back or the browser goes online, at most once a minute', async () => {
    const { checker, fetcher, doc, win, advance } = setup(async () => jsonResponse(NEWER));
    checker.start();
    doc.setVisibility('visible');
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(checker.getSnapshot().available).toBe(true);

    doc.setVisibility('hidden');
    doc.setVisibility('visible');
    win.dispatchEvent(new Event('online'));
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await advance(UPDATE_CHECK_MIN_GAP_MS);
    win.dispatchEvent(new Event('online'));
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    checker.stop();
  });

  it('retries a failed check when the connection returns, but not on every tab return', async () => {
    let online = false;
    const { checker, fetcher, doc, win, advance } = setup(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return jsonResponse(NEWER);
    });
    checker.start();
    win.dispatchEvent(new Event('online'));
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    doc.setVisibility('hidden');
    doc.setVisibility('visible');
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    online = true;
    win.dispatchEvent(new Event('online'));
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(checker.getSnapshot().available).toBe(true);
    checker.stop();
  });

  it('does nothing after stop', async () => {
    const { checker, fetcher, doc, advance } = setup(async () => jsonResponse(NEWER));
    checker.start();
    checker.stop();
    doc.setVisibility('visible');
    await advance(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('isAppUpdateCheckEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  const storage = (value: string | null) => ({ getItem: (key: string) => (key === UPDATE_CHECK_FLAG_KEY ? value : null) });

  it('is off in the dev server unless the flag asks for it', () => {
    vi.stubEnv('DEV', true);
    expect(isAppUpdateCheckEnabled(storage(null))).toBe(false);
    expect(isAppUpdateCheckEnabled(storage('true'))).toBe(true);
  });

  it('is on in built builds unless the flag turns it off', () => {
    vi.stubEnv('DEV', false);
    expect(isAppUpdateCheckEnabled(storage(null))).toBe(true);
    expect(isAppUpdateCheckEnabled(storage('false'))).toBe(false);
    expect(isAppUpdateCheckEnabled({ getItem: () => { throw new Error('blocked'); } })).toBe(true);
  });
});
