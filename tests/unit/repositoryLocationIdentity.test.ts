import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attestWritableRepositoryLocation,
  isBrowserStorageMove,
  moveRepositoryLocationIdentity,
} from '../../src/services/project/repository/backends/repositoryLocationIdentity';

// The origin-local writer registry keeps a raw copy of a project from opening as a
// second writer, but the app's own moves between OPFS and the IndexedDB fallback
// must never lock a project read-only.

type Record = { repositoryId: string; locationId: string };

/** Just enough IndexedDB for the registry: one store, get/add/put in a readwrite transaction. */
function installRegistry(records: Map<string, Record>): void {
  const db = {
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      const transaction: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error: null; objectStore: () => unknown } = {
        error: null,
        objectStore: () => ({
          get(key: string) {
            const request: { result?: Record; onsuccess?: () => void } = {};
            queueMicrotask(() => {
              request.result = records.get(key);
              request.onsuccess?.();
              queueMicrotask(() => transaction.oncomplete?.());
            });
            return request;
          },
          add(value: Record) {
            if (records.has(value.repositoryId)) throw new DOMException('exists', 'ConstraintError');
            records.set(value.repositoryId, { ...value });
          },
          put(value: Record) { records.set(value.repositoryId, { ...value }); },
        }),
      };
      return transaction;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: { result?: typeof db; onupgradeneeded?: () => void; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  });
}

const ORIGIN = 'https://192.168.1.20:5173';

describe('repository location identity', () => {
  let records: Map<string, Record>;
  beforeEach(() => {
    records = new Map();
    installRegistry(records);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('registers the first writer location and confirms it again', async () => {
    expect(await attestWritableRepositoryLocation('repo-1', `fsa:${ORIGIN}:abc`)).toBe('same-location');
    expect(await attestWritableRepositoryLocation('repo-1', `fsa:${ORIGIN}:abc`)).toBe('same-location');
    expect(records.get('repo-1')?.locationId).toBe(`fsa:${ORIGIN}:abc`);
  });

  it('opens a raw copy at another location read-only (needs-copy-restore)', async () => {
    await attestWritableRepositoryLocation('repo-1', `fsa:${ORIGIN}:abc`);
    expect(await attestWritableRepositoryLocation('repo-1', `fsa:${ORIGIN}:copy`)).toBe('needs-copy-restore');
    expect(await attestWritableRepositoryLocation('repo-1', `opfs:${ORIGIN}:My Project`)).toBe('needs-copy-restore');
    expect(records.get('repo-1')?.locationId).toBe(`fsa:${ORIGIN}:abc`);
  });

  it('treats the same browser folder in OPFS and the IndexedDB fallback as one project moving storage', async () => {
    await attestWritableRepositoryLocation('repo-1', `indexeddb:${ORIGIN}:My Project`);
    expect(await attestWritableRepositoryLocation('repo-1', `opfs:${ORIGIN}:My Project`)).toBe('same-location');
    expect(records.get('repo-1')?.locationId).toBe(`opfs:${ORIGIN}:My Project`);
    expect(await attestWritableRepositoryLocation('repo-1', `indexeddb:${ORIGIN}:My Project`)).toBe('same-location');
  });

  it('keeps other folders and origins foreign even across stores', async () => {
    await attestWritableRepositoryLocation('repo-1', `indexeddb:${ORIGIN}:My Project`);
    expect(await attestWritableRepositoryLocation('repo-1', `opfs:${ORIGIN}:My Project 2`)).toBe('needs-copy-restore');
    expect(await attestWritableRepositoryLocation('repo-1', 'opfs:https://other.example:My Project')).toBe('needs-copy-restore');
    expect(isBrowserStorageMove(`fsa:${ORIGIN}:My Project`, `opfs:${ORIGIN}:My Project`)).toBe(false);
  });

  it('hands the writer registration to a verified move under a new folder name', async () => {
    await attestWritableRepositoryLocation('repo-1', `indexeddb:${ORIGIN}:My Project`);
    expect(await moveRepositoryLocationIdentity('repo-1', `indexeddb:${ORIGIN}:My Project`, `opfs:${ORIGIN}:My Project 2`)).toBe(true);
    expect(await attestWritableRepositoryLocation('repo-1', `opfs:${ORIGIN}:My Project 2`)).toBe('same-location');
  });

  it('refuses a hand-over from a location that is not the registered writer', async () => {
    await attestWritableRepositoryLocation('repo-1', `fsa:${ORIGIN}:abc`);
    expect(await moveRepositoryLocationIdentity('repo-1', `indexeddb:${ORIGIN}:Copy`, `opfs:${ORIGIN}:Copy`)).toBe(false);
    expect(records.get('repo-1')?.locationId).toBe(`fsa:${ORIGIN}:abc`);
  });

  it('reports an unavailable registry instead of granting writes', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await attestWritableRepositoryLocation('repo-1', `opfs:${ORIGIN}:x`)).toBe('location-registry-unavailable');
    expect(await moveRepositoryLocationIdentity('repo-1', 'a', 'b')).toBe(false);
  });
});
