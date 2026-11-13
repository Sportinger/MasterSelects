import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Regressions for production error groups from 3.3.4/3.3.5 that still reproduced in 3.4.3.
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../src/services/project/core/browserStorageRoot'); });

describe('project folder listing on WebKit', () => {
  it('retries a transient UnknownError instead of failing the project list', async () => {
    const { listProjectFolderNames } = await import('../../src/services/project/core/projectRootAccess');
    const project = {
      kind: 'directory', name: 'Listed',
      getFileHandle: async (name: string) => { if (name === 'project.msrepo.json') return {}; throw new DOMException('missing', 'NotFoundError'); },
      values: async function* () { /* no archives */ },
    };
    let calls = 0;
    const root = {
      values() {
        calls += 1;
        if (calls === 1) {
          const error = new DOMException('The operation failed for an unknown transient reason (e.g. out of memory).', 'UnknownError');
          return { [Symbol.asyncIterator]() { return this; }, next: () => Promise.reject(error), return: async () => ({ done: true, value: undefined }) };
        }
        return (async function* () { yield project; })();
      },
    } as unknown as FileSystemDirectoryHandle;

    await expect(listProjectFolderNames(root)).resolves.toEqual(['Listed']);
    expect(calls).toBe(2);
  });
});

describe('temporary storage notice', () => {
  it('tells the person that projects can be lost and why', async () => {
    vi.doMock('../../src/services/project/core/browserStorageRoot', async (importOriginal) => ({
      ...await importOriginal<typeof import('../../src/services/project/core/browserStorageRoot')>(),
      isBrowserStorageFallbackActive: () => true,
      getBrowserStorageFallbackReason: () => 'missing',
      subscribeBrowserStorageKind: () => () => {},
    }));
    const { TemporaryStorageNotice, TEMPORARY_STORAGE_NOTICE_TITLE } = await import('../../src/components/common/TemporaryStorageNotice');
    render(<TemporaryStorageNotice className="notice" />);
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain(TEMPORARY_STORAGE_NOTICE_TITLE);
    expect(notice.textContent).toContain('too old');
    expect(notice.textContent).toContain('Save permanently');
  });

  it('stays hidden while projects are stored permanently', async () => {
    vi.doMock('../../src/services/project/core/browserStorageRoot', async (importOriginal) => ({
      ...await importOriginal<typeof import('../../src/services/project/core/browserStorageRoot')>(),
      isBrowserStorageFallbackActive: () => false,
      subscribeBrowserStorageKind: () => () => {},
    }));
    const { TemporaryStorageNotice } = await import('../../src/components/common/TemporaryStorageNotice');
    render(<TemporaryStorageNotice className="notice" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('FAST export source that changed on disk', () => {
  it('recognises a file Chromium refuses to read after it changed', async () => {
    const { isChangedSourceFailure } = await import('../../src/engine/export/clipPreparation/changedSourceFailure');
    expect(isChangedSourceFailure([new DOMException('The requested file could not be read', 'NotReadableError')])).toBe(true);
    expect(isChangedSourceFailure([new TypeError('Failed to fetch')])).toBe(false);
    expect(isChangedSourceFailure([])).toBe(false);
  });
});
