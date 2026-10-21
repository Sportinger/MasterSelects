import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  order: [] as string[],
  retry: vi.fn(async () => {}),
  requestLinkedMedia: vi.fn(async () => true),
  requestMediaFileAccess: vi.fn(async () => {}),
  roots: [] as Array<{ id: string; name: string; handle: unknown; permission: PermissionState }>,
  requestRoot: vi.fn(async () => null as unknown),
  storedHandles: new Map<string, unknown>(),
  cachedHandles: new Map<string, unknown>(),
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => mocks.session,
  retryEditorRepository: () => { mocks.order.push('retry'); return mocks.retry(); },
}));
vi.mock('../../src/services/project/linkedMediaDemand', () => ({
  requestLinkedMedia: (id: string) => { mocks.order.push(`media:${id}`); return mocks.requestLinkedMedia(id); },
}));
vi.mock('../../src/services/project/mediaSourceRootAccess', () => ({ requestMediaFileAccess: mocks.requestMediaFileAccess }));
vi.mock('../../src/services/project/mediaSourceRoots', () => ({
  // Like the real lookup: permissions are queried freshly on every call.
  getProjectMediaSourceRootStates: async () => Promise.all(mocks.roots.map(async root => ({
    ...root, permission: await (root.handle as { queryPermission(): Promise<PermissionState> }).queryPermission() }))),
  requestProjectMediaSourceRootAccess: mocks.requestRoot,
  getMediaSourceRootHandle: async (id: string) => mocks.roots.find(root => root.id === id)?.handle ?? null,
}));
vi.mock('../../src/services/projectDB', () => ({ projectDB: { getStoredHandle: async (key: string) => mocks.storedHandles.get(key) ?? null } }));
vi.mock('../../src/services/fileSystemService', () => ({ fileSystemService: { getFileHandle: (id: string) => mocks.cachedHandles.get(id) } }));

import { resumeFolderAccess } from '../../src/services/project/folderAccess/folderAccessResume';
import {
  getFolderAccessPause, isMediaAccessPaused, noteFolderAccessFailure, rememberGrantedLocation, resetFolderAccessPause,
} from '../../src/services/project/folderAccess/folderAccessPause';
import { pauseMediaIfAccessLapsed, rememberMediaLocationAccess } from '../../src/services/project/folderAccess/mediaLocationAccess';
import { RepositoryError } from '../../src/services/project/repository/contracts';

function handle(name: string, kind: 'directory' | 'file' = 'directory') {
  let state: PermissionState = 'granted';
  let answer: PermissionState = 'granted';
  const value = {
    kind, name,
    queryPermission: vi.fn(async () => state),
    requestPermission: vi.fn(async () => { mocks.order.push(`prompt:${name}`); state = answer; return answer; }),
  };
  return { value, lapse() { state = 'prompt'; }, answer(next: PermissionState) { answer = next; } };
}
function fsaSession(project: ReturnType<typeof handle>, accessError = true) {
  return {
    location: { kind: 'fsa', handle: project.value },
    opening: { writable: true },
    coordinator: { getStatus: () => ({ error: accessError ? new RepositoryError('access', 'not allowed') : null }) },
  };
}

beforeEach(() => {
  mocks.order.length = 0; mocks.roots = []; mocks.storedHandles.clear(); mocks.cachedHandles.clear();
  mocks.retry.mockReset().mockResolvedValue(undefined);
  mocks.requestLinkedMedia.mockReset().mockResolvedValue(true);
  mocks.requestMediaFileAccess.mockClear(); mocks.requestRoot.mockClear();
});
afterEach(() => resetFolderAccessPause());

describe('Re-allow after the browser paused folder access', () => {
  it('asks for the project folder first, then resumes queued saves and waiting media without data loss', async () => {
    const project = handle('Show'); const footage = handle('Footage');
    mocks.session = fsaSession(project);
    rememberGrantedLocation('project', project.value as unknown as FileSystemHandle, 'readwrite');
    rememberGrantedLocation('root:footage', footage.value as unknown as FileSystemHandle);
    project.lapse(); footage.lapse();
    noteFolderAccessFailure(new RepositoryError('access', 'The request is not allowed'));
    // A media read failed while paused: it waits instead of going offline.
    expect(await pauseMediaIfAccessLapsed({ id: 'clip-1', sourceRootId: 'footage' }, null)).toBe(false);
    mocks.roots = [{ id: 'footage', name: 'Footage', handle: footage.value, permission: 'prompt' }];
    expect(await pauseMediaIfAccessLapsed({ id: 'clip-1', sourceRootId: 'footage' }, null)).toBe(true);
    expect(getFolderAccessPause()).toMatchObject({ paused: true, project: true, mediaIds: ['clip-1'] });

    expect(await resumeFolderAccess()).toBe(true);
    // The project folder prompt runs first, while the click's user activation is fresh.
    expect(mocks.order[0]).toBe('prompt:Show');
    expect(project.value.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(mocks.order).toEqual(['prompt:Show', 'prompt:Footage', 'retry', 'media:clip-1']);
    expect(mocks.requestMediaFileAccess).toHaveBeenCalledWith(['clip-1']);
    expect(getFolderAccessPause()).toMatchObject({ paused: false, project: false, mediaIds: [], phase: 'idle', failure: null });
  });

  it('keeps the queued saves and the pause when the browser refuses, without a relink', async () => {
    const project = handle('Show'); project.answer('denied');
    mocks.session = fsaSession(project);
    rememberGrantedLocation('project', project.value as unknown as FileSystemHandle, 'readwrite');
    project.lapse();
    noteFolderAccessFailure(new RepositoryError('access', 'The request is not allowed'));

    expect(await resumeFolderAccess()).toBe(false);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(getFolderAccessPause()).toMatchObject({ paused: true, project: true, phase: 'idle' });
    expect(getFolderAccessPause().failure).toContain('Show');
  });

  it('stays paused when the retried save is refused again', async () => {
    const project = handle('Show');
    mocks.session = fsaSession(project);
    noteFolderAccessFailure(new RepositoryError('access', 'not allowed'));
    mocks.retry.mockRejectedValueOnce(new RepositoryError('access', 'still not allowed'));
    await resumeFolderAccess();
    expect(getFolderAccessPause().project).toBe(true);
  });

  it('hands media that still cannot be read to the reconnect dialog after one Re-allow', async () => {
    const project = handle('Show'); const file = handle('take.mov', 'file');
    mocks.session = fsaSession(project, false);
    mocks.cachedHandles.set('clip-2', file.value);
    await rememberMediaLocationAccess({ id: 'clip-2' });
    file.lapse(); file.answer('prompt');
    expect(await pauseMediaIfAccessLapsed({ id: 'clip-2' }, null)).toBe(true);
    mocks.requestLinkedMedia.mockImplementation(async (id: string) => {
      // The opener asks again: a declined media is no longer paused, so it goes offline.
      expect(await pauseMediaIfAccessLapsed({ id }, null)).toBe(false);
      return false;
    });
    await resumeFolderAccess();
    expect(mocks.requestLinkedMedia).toHaveBeenCalledWith('clip-2');
    expect(isMediaAccessPaused('clip-2')).toBe(false);
  });

  it('never pauses media whose location was not allowed at any point in this session', async () => {
    const file = handle('take.mov', 'file'); file.lapse();
    mocks.storedHandles.set('media_clip-3', file.value);
    expect(await pauseMediaIfAccessLapsed({ id: 'clip-3' }, null)).toBe(false);
    expect(getFolderAccessPause().paused).toBe(false);
  });
});
