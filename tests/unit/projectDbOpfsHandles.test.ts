import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAllHandles, getStoredHandle, hasLastProject, storeHandle,
} from '../../src/services/projectDb/handles';
import { storeLastOpfsProjectName } from '../../src/services/project/tabProjectPersistence';

function request<T>(result: T): IDBRequest<T> {
  const pending = { result } as IDBRequest<T>;
  queueMicrotask(() => pending.onsuccess?.call(pending, new Event('success')));
  return pending;
}

function database(initial: Array<{ key: string; handle: FileSystemHandle }> = []) {
  const records = new Map(initial.map(entry => [entry.key, entry]));
  const store = {
    put: vi.fn((entry: { key: string; handle: FileSystemHandle }) => {
      records.set(entry.key, entry);
      return request(entry.key);
    }),
    get: vi.fn((key: string) => request(records.get(key))),
    count: vi.fn((key: string) => request(Number(records.has(key)))),
    getAll: vi.fn(() => request([...records.values()])),
    getAllKeys: vi.fn(() => request([...records.keys()])),
  };
  const transaction = vi.fn(() => ({ objectStore: () => store }));
  return { db: { transaction } as unknown as IDBDatabase, store, transaction };
}

const handle = { kind: 'directory', name: 'Saved project' } as FileSystemDirectoryHandle;
const log = { debug: vi.fn(), info: vi.fn() };

describe('OPFS project handle cache isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('showDirectoryPicker', undefined);
    vi.stubGlobal('showSaveFilePicker', undefined);
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['projectsFolder', 'lastProject', 'lastProject:tab', 'recentProject:old'])(
    'never serializes or deserializes the legacy OPFS project key %s', async key => {
      const { db, transaction } = database([{ key, handle }]);
      await storeHandle(db, log, key, handle);
      expect(await getStoredHandle(db, key)).toBeNull();
      expect(transaction).not.toHaveBeenCalled();
    });

  it('polls legacy project existence without reading its structured-cloned value', async () => {
    const { db, store } = database([{ key: 'lastProject', handle }]);
    store.get.mockImplementation(() => { throw new Error('Unsafe handle deserialization'); });
    expect(await hasLastProject(db)).toBe(true);
    expect(store.count).toHaveBeenCalledWith('lastProject');
    expect(store.get).not.toHaveBeenCalled();
    expect(await hasLastProject(database().db)).toBe(false);
  });

  it('recognizes an OPFS project by name without a cached handle', async () => {
    const { db, transaction } = database();
    storeLastOpfsProjectName('Saved project');
    expect(await hasLastProject(db)).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('preserves imported and relinked external handles while skipping legacy project values', async () => {
    const external = { kind: 'file', name: 'source.mov' } as FileSystemFileHandle;
    const { db, store } = database([{ key: 'lastProject', handle }, { key: 'recentProject:old', handle }]);
    await storeHandle(db, log, 'media_source-1', external);
    expect(await getStoredHandle(db, 'media_source-1')).toBe(external);
    expect(await getAllHandles(db)).toEqual([{ key: 'media_source-1', handle: external }]);
    expect(store.getAll).not.toHaveBeenCalled();
    expect(store.get.mock.calls.every(([key]) => key === 'media_source-1')).toBe(true);
  });

  it('keeps user-picked FSA directory restoration while polling by count', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn());
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    const { db, store } = database();
    await storeHandle(db, log, 'lastProject', handle);
    expect(await hasLastProject(db)).toBe(true);
    expect(store.get).not.toHaveBeenCalled();
    expect(await getStoredHandle(db, 'lastProject')).toBe(handle);
    expect(await getAllHandles(db)).toEqual([{ key: 'lastProject', handle }]);
  });
});
