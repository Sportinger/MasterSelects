import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handles: new Map<string, unknown>() }));
vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getStoredHandle: vi.fn(async (key: string) => mocks.handles.get(key) ?? null),
    storeHandle: vi.fn(async (key: string, handle: unknown) => { mocks.handles.set(key, handle); }),
    deleteHandle: vi.fn(async (key: string) => { mocks.handles.delete(key); }),
  },
}));

import { requestMediaSourceRootAccess } from '../../src/services/project/mediaSourceRootAccess';
import {
  addRecentFsaProject,
  getRecentFsaProjectMediaSourceRootIds,
  rememberRecentFsaProjectMediaSourceRoots,
} from '../../src/services/project/recentProjects';
import type { ProjectFile } from '../../src/services/project/types';

function folder(name: string, permission: PermissionState = 'prompt') {
  return {
    kind: 'directory' as const,
    name,
    isSameEntry: vi.fn(async (other: { name?: string }) => other?.name === name),
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
  };
}

beforeEach(() => {
  mocks.handles.clear();
  localStorage.clear();
  Object.assign(window, { showDirectoryPicker: vi.fn(), showSaveFilePicker: vi.fn() });
});

describe('media folder access on project open', () => {
  it('requests read access only for stored folders that lost it', async () => {
    const lapsed = folder('Footage');
    const granted = folder('Audio', 'granted');
    mocks.handles.set('media_source_root:a', lapsed);
    mocks.handles.set('media_source_root:b', granted);

    await requestMediaSourceRootAccess(['a', 'b', 'missing', 'a']);

    expect(lapsed.requestPermission).toHaveBeenCalledOnce();
    expect(lapsed.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(granted.requestPermission).not.toHaveBeenCalled();
  });

  it('continues with later folders when one prompt fails', async () => {
    const failing = folder('Footage');
    failing.requestPermission.mockRejectedValue(new DOMException('User activation is required', 'SecurityError'));
    const next = folder('Audio');
    mocks.handles.set('media_source_root:a', failing);
    mocks.handles.set('media_source_root:b', next);

    await expect(requestMediaSourceRootAccess(['a', 'b'])).resolves.toBeUndefined();
    expect(next.requestPermission).toHaveBeenCalledOnce();
  });

  it('remembers a project\'s media folders with its recent entry', async () => {
    const project = folder('My Project') as unknown as FileSystemDirectoryHandle;
    await addRecentFsaProject(project, {
      name: 'My Project',
      mediaSourceRoots: [{ id: 'source-root:1', name: 'Footage' }],
    } as unknown as ProjectFile);
    expect(await getRecentFsaProjectMediaSourceRootIds(project)).toEqual(['source-root:1']);

    await rememberRecentFsaProjectMediaSourceRoots(project, ['source-root:1', 'source-root:2']);
    expect(await getRecentFsaProjectMediaSourceRootIds(project)).toEqual(['source-root:1', 'source-root:2']);

    // Re-adding without project data keeps the known folders.
    await addRecentFsaProject(project, null);
    expect(await getRecentFsaProjectMediaSourceRootIds(project)).toEqual(['source-root:1', 'source-root:2']);
    expect(await getRecentFsaProjectMediaSourceRootIds(folder('Other') as unknown as FileSystemDirectoryHandle)).toEqual([]);
  });
});
