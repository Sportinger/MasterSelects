import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeHandle = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock('../../src/services/projectDB', () => ({
  projectDB: { storeHandle },
}));

import {
  rememberLastProject,
  rememberProjectParent,
} from '../../src/services/project/core/projectDirectoryPersistence';

const handle = { kind: 'directory', name: 'Persistent project' } as FileSystemDirectoryHandle;

describe('FSA project handle persistence', () => {
  beforeEach(() => {
    storeHandle.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('showDirectoryPicker', vi.fn());
    vi.stubGlobal('showSaveFilePicker', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['parent folder', rememberProjectParent, ['projectsFolder']],
    ['last project', rememberLastProject, ['lastProject:', 'lastProject']],
  ] as const)('requests persistent storage before caching the %s handle', async (_label, remember, keyPrefixes) => {
    const callOrder: string[] = [];
    const persisted = vi.fn(async () => {
      callOrder.push('persisted');
      return false;
    });
    const persist = vi.fn(async () => {
      callOrder.push('persist');
      return true;
    });
    storeHandle.mockImplementation(async key => {
      callOrder.push(`store:${key}`);
    });
    vi.stubGlobal('navigator', { storage: { persisted, persist } });

    await remember(handle);

    expect(persisted).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    const storedKeys = storeHandle.mock.calls.map(([key]) => key);
    expect(storedKeys).toHaveLength(keyPrefixes.length);
    expect(storedKeys.every((key, index) => key.startsWith(keyPrefixes[index]!))).toBe(true);
    expect(callOrder.slice(0, 2)).toEqual(['persisted', 'persist']);
    expect(callOrder.slice(2).every(entry => entry.startsWith('store:'))).toBe(true);
  });
});
