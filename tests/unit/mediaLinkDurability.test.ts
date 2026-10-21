import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Linked media survive a reload only when the browser can keep their
// FileSystemHandle in IndexedDB. WebKit cannot, so imports are copied there.

const mocks = vi.hoisted(() => ({ canStoreHandle: vi.fn(async (_handle: unknown) => true) }));
vi.mock('../../src/services/projectDB', () => ({ projectDB: { canStoreHandle: mocks.canStoreHandle } }));

import { canStoreHandle } from '../../src/services/projectDb/handles';
import {
  getMediaLinkDurability,
  isCopyingUndurableMedia,
  probeMediaLinkDurability,
  resetMediaLinkDurabilityForTests,
  setCopyingUndurableMedia,
} from '../../src/services/project/mediaCopy/mediaLinkDurability';

class FakeFileSystemHandle {}

function fakeDb(put: () => void) {
  const transaction = { abort: vi.fn(), onerror: null, objectStore: () => ({ put: () => { put(); return {}; } }) };
  return { db: { transaction: () => transaction } as unknown as IDBDatabase, transaction };
}

describe('canStoreHandle', () => {
  it('accepts a cloneable handle and aborts the probe write', () => {
    const { db, transaction } = fakeDb(() => {});
    expect(canStoreHandle(db, {} as FileSystemHandle)).toBe(true);
    expect(transaction.abort).toHaveBeenCalledOnce();
  });

  it('reports WebKit DataCloneError as not storable', () => {
    const { db, transaction } = fakeDb(() => { throw new DOMException('cannot clone', 'DataCloneError'); });
    expect(canStoreHandle(db, {} as FileSystemHandle)).toBe(false);
    expect(transaction.abort).toHaveBeenCalledOnce();
  });

  it('does not hide other storage errors', () => {
    const { db } = fakeDb(() => { throw new DOMException('closing', 'InvalidStateError'); });
    expect(() => canStoreHandle(db, {} as FileSystemHandle)).toThrow('closing');
  });
});

describe('probeMediaLinkDurability', () => {
  beforeEach(() => {
    resetMediaLinkDurabilityForTests();
    localStorage.clear();
    mocks.canStoreHandle.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('measures with the real import handle and remembers the answer', async () => {
    vi.stubGlobal('FileSystemHandle', FakeFileSystemHandle);
    mocks.canStoreHandle.mockResolvedValue(false);
    const handle = new FakeFileSystemHandle() as FileSystemHandle;
    expect(await probeMediaLinkDurability(handle)).toBe('not-durable');
    expect(await probeMediaLinkDurability(handle)).toBe('not-durable');
    expect(mocks.canStoreHandle).toHaveBeenCalledOnce();
    expect(mocks.canStoreHandle).toHaveBeenCalledWith(handle);
    expect(getMediaLinkDurability()).toBe('not-durable');
  });

  it('samples the browser storage root when no import handle is given', async () => {
    vi.stubGlobal('FileSystemHandle', FakeFileSystemHandle);
    const root = new FakeFileSystemHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    mocks.canStoreHandle.mockResolvedValue(true);
    expect(await probeMediaLinkDurability()).toBe('durable');
    expect(mocks.canStoreHandle).toHaveBeenCalledWith(root);
  });

  it('stays unknown when no handle can be sampled, so the next import measures again', async () => {
    vi.stubGlobal('FileSystemHandle', FakeFileSystemHandle);
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => { throw new DOMException('refused', 'UnknownError'); } } });
    expect(await probeMediaLinkDurability()).toBe('unknown');
    mocks.canStoreHandle.mockResolvedValue(false);
    expect(await probeMediaLinkDurability(new FakeFileSystemHandle() as FileSystemHandle)).toBe('not-durable');
  });

  it('treats a browser without the handle API as not durable', async () => {
    vi.stubGlobal('FileSystemHandle', undefined);
    expect(await probeMediaLinkDurability()).toBe('not-durable');
    expect(mocks.canStoreHandle).not.toHaveBeenCalled();
  });

  it('copies by default and remembers the choice to keep such media linked', () => {
    expect(isCopyingUndurableMedia()).toBe(true);
    setCopyingUndurableMedia(false);
    resetMediaLinkDurabilityForTests();
    expect(isCopyingUndurableMedia()).toBe(false);
    setCopyingUndurableMedia(true);
    resetMediaLinkDurabilityForTests();
    expect(isCopyingUndurableMedia()).toBe(true);
  });
});
