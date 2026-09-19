import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let request: {
  result?: IDBDatabase;
  transaction: EventTarget & { abort: ReturnType<typeof vi.fn> };
  onupgradeneeded?: (event: unknown) => void;
  onsuccess?: () => void;
};
beforeEach(() => {
  vi.resetModules();
  request = { transaction: Object.assign(new EventTarget(), { abort: vi.fn() }) };
  vi.stubGlobal('indexedDB', { open: () => request });
});
afterEach(() => vi.unstubAllGlobals());

for (const database of ['project', 'youtube']) {
  async function begin() {
    if (database === 'project') {
      const { projectDB } = await import('../../src/services/projectDB');
      return { pending: projectDB.init() };
    }
    const { youtubeCredentialManager } = await import('../../src/services/youtubeCredentialManager');
    return { pending: youtubeCredentialManager.get() };
  }

  describe(`${database} database open callbacks`, () => {
    it('rejects a missing upgrade result without throwing globally', async () => {
      const { pending } = await begin();
      const rejected = expect(pending).rejects.toMatchObject({ name: 'InvalidStateError' });
      expect(() => request.onupgradeneeded?.({ target: request, oldVersion: 0 })).not.toThrow();
      await rejected;
      expect(request.transaction.abort).toHaveBeenCalledOnce();
    });

    it('rejects a missing successful-open result without throwing globally', async () => {
      const { pending } = await begin();
      const rejected = expect(pending).rejects.toMatchObject({ name: 'InvalidStateError' });
      expect(() => request.onsuccess?.()).not.toThrow();
      await rejected;
    });

    it('completes a valid schema upgrade and preserves integration-key exclusions', async () => {
      const deleted = vi.fn();
      const stores = new Set<string>();
      const store = {
        createIndex: vi.fn(),
        delete: deleted,
        get: () => {
          const read: { result?: unknown; onsuccess?: () => void } = {};
          queueMicrotask(() => {
            read.onsuccess?.();
            request.transaction.dispatchEvent(new Event('complete'));
          });
          return read;
        },
      };
      const transaction = Object.assign(request.transaction, { objectStore: () => store });
      const db = Object.assign(new EventTarget(), {
        objectStoreNames: { contains: (name: string) => stores.has(name) },
        createObjectStore: (name: string) => { stores.add(name); return store; },
        transaction: () => transaction,
        close: vi.fn(),
      }) as unknown as IDBDatabase;
      request.result = db;
      const { pending } = await begin();
      let settled = false;
      void pending.then(() => { settled = true; });
      request.onupgradeneeded?.({ target: request, oldVersion: 0 });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(transaction.abort).not.toHaveBeenCalled();
      request.onsuccess?.();
      if (database === 'project') {
        expect(await pending).toBe(db);
        expect(stores.has('projects')).toBe(true);
        expect(stores.has('artifactBlobs')).toBe(true);
      } else {
        expect(await pending).toBeNull();
        expect(stores.has('api-keys')).toBe(true);
        expect(deleted).toHaveBeenCalledWith('openai-api-key');
        expect(deleted).not.toHaveBeenCalledWith('youtube-api-key');
        expect(deleted).not.toHaveBeenCalledWith('encryption-key');
      }
    });

    it('aborts failed migration and closes a late connection rather than adopting it', async () => {
      const failure = new DOMException('Migration write failed', 'QuotaExceededError');
      const db = Object.assign(new EventTarget(), {
        objectStoreNames: { contains: () => false },
        createObjectStore: () => { throw failure; },
        close: vi.fn(),
      }) as unknown as IDBDatabase;
      request.result = db;
      const { pending } = await begin();
      const rejected = expect(pending).rejects.toBe(failure);
      expect(() => request.onupgradeneeded?.({ target: request, oldVersion: 0 })).not.toThrow();
      await rejected;
      expect(request.transaction.abort).toHaveBeenCalledOnce();
      request.onsuccess?.();
      expect(db.close).toHaveBeenCalled();
      if (database === 'project') {
        const { projectDB } = await import('../../src/services/projectDB');
        expect(projectDB.isAvailable()).toBe(false);
      }
    });
  });
}
