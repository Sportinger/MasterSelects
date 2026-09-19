import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let requests: Array<{ onerror?: () => void; onsuccess?: () => void; error: DOMException | null; result?: IDBDatabase }>;
let open: ReturnType<typeof vi.fn>;
let manager: typeof import('../../src/services/youtubeCredentialManager')['youtubeCredentialManager'];
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules();
  requests = [];
  open = vi.fn(() => { const request = { error: null }; requests.push(request); return request; });
  vi.stubGlobal('indexedDB', { open });
  manager = (await import('../../src/services/youtubeCredentialManager')).youtubeCredentialManager;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fail(index: number, name = 'AbortError') {
  requests[index].error = new DOMException('Credential database open failed', name);
  requests[index].onerror?.();
}

function succeed(index: number) {
  const read = { result: undefined, onsuccess: undefined as (() => void) | undefined };
  const transaction = Object.assign(new EventTarget(), { objectStore: () => ({ get: () => read }) });
  const db = {
    close: vi.fn(),
    objectStoreNames: { contains: () => true },
    transaction: vi.fn(() => transaction),
  } as unknown as IDBDatabase;
  requests[index].result = db;
  requests[index].onsuccess?.();
  return { finish: () => { read.onsuccess?.(); transaction.dispatchEvent(new Event('complete')); } };
}

it('recovers an aborted credential open without changing stored values', async () => {
  const pending = manager.get();
  fail(0);
  await flush();
  expect(open).toHaveBeenCalledTimes(2);
  const read = succeed(1);
  await flush();
  read.finish();
  expect(await pending).toBeNull();
  expect(open).toHaveBeenNthCalledWith(2, 'multicam-settings', 3);
});

it('bounds repeated aborts and allows a later call to recover', async () => {
  const pending = expect(manager.get()).rejects.toMatchObject({ name: 'AbortError' });
  fail(0);
  await flush();
  fail(1);
  await pending;
  expect(open).toHaveBeenCalledTimes(2);
  const later = manager.get();
  const read = succeed(2);
  await flush();
  read.finish();
  expect(await later).toBeNull();
});

it('does not retry access denial', async () => {
  const pending = expect(manager.get()).rejects.toMatchObject({ name: 'SecurityError' });
  fail(0, 'SecurityError');
  await pending;
  expect(open).toHaveBeenCalledTimes(1);
});
