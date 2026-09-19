import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let requests: Array<{ onerror?: () => void; onsuccess?: () => void; error: DOMException | null; result?: IDBDatabase }>;
let open: ReturnType<typeof vi.fn>;
let projectDB: typeof import('../../src/services/projectDB')['projectDB'];
beforeEach(async () => {
  vi.resetModules();
  requests = [];
  open = vi.fn(() => { const request = { error: null }; requests.push(request); return request; });
  vi.stubGlobal('indexedDB', { open });
  projectDB = (await import('../../src/services/projectDB')).projectDB;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fail(index: number, name = 'AbortError') {
  requests[index].error = new DOMException('Storage open failed', name);
  requests[index].onerror?.();
}
function succeed(index: number) {
  const db = Object.assign(new EventTarget(), { close: vi.fn(), objectStoreNames: { contains: () => true } }) as unknown as IDBDatabase;
  requests[index].result = db;
  requests[index].onsuccess?.();
  return db;
}

describe('project database initialization recovery', () => {
  it('retries an aborted open once and shares recovery among concurrent callers', async () => {
    const first = projectDB.init();
    const second = projectDB.init();
    const results = Promise.allSettled([first, second]);
    fail(0);
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
    const db = succeed(1);
    expect(await results).toEqual([{ status: 'fulfilled', value: db }, { status: 'fulfilled', value: db }]);
    expect(projectDB.hasInitFailed()).toBe(false);
  });

  it('bounds persistent failures but allows a later operation to recover', async () => {
    let now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const pending = expect(projectDB.init()).rejects.toMatchObject({ name: 'AbortError' });
    fail(0);
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
    fail(1);
    await pending;
    expect(projectDB.hasInitFailed()).toBe(true);
    await expect(projectDB.init()).rejects.toMatchObject({ name: 'AbortError' });
    expect(open).toHaveBeenCalledTimes(2);
    now += 5000;
    const recovered = projectDB.init();
    expect(open).toHaveBeenCalledTimes(3);
    const db = succeed(2);
    expect(await recovered).toBe(db);
    expect(projectDB.isAvailable()).toBe(true);
  });

  it('reopens after a version change closes a successful connection', async () => {
    const initial = projectDB.init();
    const first = succeed(0);
    await initial;
    first.dispatchEvent(new Event('versionchange'));
    expect(first.close).toHaveBeenCalledOnce();
    expect(projectDB.isAvailable()).toBe(false);
    const reopened = projectDB.init();
    expect(open).toHaveBeenCalledTimes(2);
    const second = succeed(1);
    expect(await reopened).toBe(second);
  });

  it('records synchronous browser denial without an immediate retry', async () => {
    open.mockImplementation(() => { throw new DOMException('Storage denied', 'SecurityError'); });
    await expect(projectDB.init()).rejects.toMatchObject({ name: 'SecurityError' });
    expect(projectDB.hasInitFailed()).toBe(true);
    await expect(projectDB.init()).rejects.toMatchObject({ name: 'SecurityError' });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not fork a pending open when resetting a previous failure', async () => {
    const first = projectDB.init();
    projectDB.resetInitFailure();
    const second = projectDB.init();
    expect(open).toHaveBeenCalledTimes(1);
    const db = succeed(0);
    expect(await first).toBe(db);
    expect(await second).toBe(db);
  });
});
