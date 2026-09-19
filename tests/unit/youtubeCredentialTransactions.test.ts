import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../src/services/projectDb/openDatabase', () => ({ openDatabase: mocks.open }));
let transaction: IDBTransaction;
let request: { onsuccess?: () => void; onerror?: () => void; result: undefined; transaction: IDBTransaction };
let close: ReturnType<typeof vi.fn>;
let manager: typeof import('../../src/services/youtubeCredentialManager')['youtubeCredentialManager'];
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules();
  transaction = Object.assign(new EventTarget(), { error: null, objectStore: () => ({ delete: () => request, get: () => request }) }) as unknown as IDBTransaction;
  request = { result: undefined, transaction };
  close = vi.fn();
  mocks.open.mockResolvedValue({ transaction: () => transaction, close });
  manager = (await import('../../src/services/youtubeCredentialManager')).youtubeCredentialManager;
});

it('does not acknowledge deletion until its transaction commits', async () => {
  let completed = false;
  const pending = manager.clear().then(() => { completed = true; });
  await flush();
  request.onsuccess?.();
  await flush();
  expect(completed).toBe(false);
  transaction.dispatchEvent(new Event('complete'));
  await pending;
  expect(close).toHaveBeenCalledOnce();
});

it('rejects rollback after successful deletion request and closes the connection', async () => {
  const pending = expect(manager.clear()).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  request.onsuccess?.();
  transaction.dispatchEvent(new Event('abort'));
  await pending;
  expect(close).toHaveBeenCalledOnce();
});

it('rejects a read transaction aborted before its request settles', async () => {
  const pending = expect(manager.get()).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  transaction.dispatchEvent(new Event('abort'));
  await pending;
  expect(close).toHaveBeenCalledOnce();
});
