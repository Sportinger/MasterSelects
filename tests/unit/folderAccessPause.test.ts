import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectTransactionCoordinator, type CoordinatorStorage } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { RepositoryError, toRepositoryError, type EntityDTO } from '../../src/services/project/repository/contracts';
import {
  canPauseMediaAccess, checkGrantedLocations, clearProjectFolderAccessPause, getFolderAccessPause, hasLapsedGrantedLocation,
  isFolderAccessLossError, isMediaAccessPaused, lapsedGrantedLocations, noteFolderAccessFailure, noteMediaAccessRestored,
  pauseMediaAccess, rememberGrantedLocation, resetFolderAccessPause, subscribeFolderAccessPause, takePausedMedia,
} from '../../src/services/project/folderAccess/folderAccessPause';

function permissionHandle(name: string, initial: PermissionState = 'granted') {
  let state = initial;
  const handle = { kind: 'directory', name, queryPermission: vi.fn(async () => state) } as unknown as FileSystemHandle;
  return { handle, set(next: PermissionState) { state = next; } };
}
const entity = (value: number): EntityDTO => ({ type: 'fixture', schemaVersion: 1, value, references: [], blobs: [] });

afterEach(() => resetFolderAccessPause());

describe('folder access loss detection', () => {
  it('recognizes the browser withdrawing access in every form it reaches the editor', () => {
    expect(isFolderAccessLossError(new DOMException('Permission revoked', 'NotAllowedError'))).toBe(true);
    expect(isFolderAccessLossError(new DOMException('Blocked', 'SecurityError'))).toBe(true);
    expect(isFolderAccessLossError(new RepositoryError('access', 'The request is not allowed'))).toBe(true);
    // Relayed by older storage workers as generic I/O text.
    expect(isFolderAccessLossError(new RepositoryError('io', 'NotAllowedError: The request is not allowed'))).toBe(true);
    expect(isFolderAccessLossError(new Error('wrapped', { cause: new DOMException('x', 'NotAllowedError') }))).toBe(true);
    // Repository policy refusals and other failures are not a paused grant.
    expect(isFolderAccessLossError(new RepositoryError('permission', 'Invalid repository path'))).toBe(false);
    expect(isFolderAccessLossError(new RepositoryError('quota', 'Disk full'))).toBe(false);
    expect(isFolderAccessLossError(new DOMException('Missing', 'NotFoundError'))).toBe(false);
  });

  it('maps raw storage exceptions to precise repository codes', () => {
    expect(toRepositoryError(new DOMException('no', 'NotAllowedError')).code).toBe('access');
    expect(toRepositoryError(new DOMException('no', 'SecurityError')).code).toBe('access');
    expect(toRepositoryError(new DOMException('full', 'QuotaExceededError')).code).toBe('quota');
    // Files deleted or moved on disk while the project was open.
    expect(toRepositoryError(new DOMException('gone', 'NotFoundError')).code).toBe('missing');
    expect(toRepositoryError(new Error('boom')).code).toBe('io');
    const original = new RepositoryError('conflict', 'kept');
    expect(toRepositoryError(original)).toBe(original);
  });

  it('pauses the project on a storage access failure and ignores other failures', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFolderAccessPause(listener);
    expect(noteFolderAccessFailure(new RepositoryError('io', 'Disk error'))).toBe(false);
    expect(getFolderAccessPause().paused).toBe(false);
    expect(noteFolderAccessFailure(new RepositoryError('access', 'not allowed'))).toBe(true);
    expect(getFolderAccessPause()).toMatchObject({ paused: true, project: true });
    expect(listener).toHaveBeenCalledTimes(1);
    // The snapshot is stable while nothing changes (useSyncExternalStore).
    const snapshot = getFolderAccessPause();
    noteFolderAccessFailure(new RepositoryError('access', 'again'));
    expect(getFolderAccessPause()).toBe(snapshot);
    clearProjectFolderAccessPause();
    expect(getFolderAccessPause().paused).toBe(false);
    unsubscribe();
  });

  it('notices a lapsed grant on a location used in this session before any save fails', async () => {
    const project = permissionHandle('Project');
    const media = permissionHandle('Footage');
    rememberGrantedLocation('project', project.handle, 'readwrite');
    rememberGrantedLocation('root:footage', media.handle);
    expect(await checkGrantedLocations()).toBe(false);
    expect(await hasLapsedGrantedLocation()).toBe(false);

    project.set('prompt'); media.set('prompt');
    expect(await checkGrantedLocations()).toBe(true);
    expect(getFolderAccessPause()).toMatchObject({ paused: true, project: true });
    expect((await lapsedGrantedLocations()).map(location => location.key)).toEqual(['project', 'root:footage']);
    expect(project.handle.queryPermission).toHaveBeenLastCalledWith({ mode: 'readwrite' });

    // Granted again elsewhere (e.g. another prompt): only the lapse clears; a queued save still needs Re-allow.
    project.set('granted'); media.set('granted');
    await checkGrantedLocations();
    expect(getFolderAccessPause()).toMatchObject({ paused: true, project: true });
    clearProjectFolderAccessPause();
    expect(getFolderAccessPause().paused).toBe(false);
  });

  it('keeps paused media waiting, hands them back once, then lets the reconnect dialog own failures', () => {
    pauseMediaAccess('clip-a');
    expect(isMediaAccessPaused('clip-a')).toBe(true);
    expect(getFolderAccessPause()).toMatchObject({ paused: true, project: false, mediaIds: ['clip-a'] });
    expect(takePausedMedia()).toEqual(['clip-a']);
    expect(isMediaAccessPaused('clip-a')).toBe(false);
    expect(canPauseMediaAccess('clip-a')).toBe(false);
    noteMediaAccessRestored('clip-a');
    expect(canPauseMediaAccess('clip-a')).toBe(true);
  });
});

describe('queued saves across a paused folder', () => {
  it('keeps every edit made while access is paused and publishes all of them in order on resume', async () => {
    let allowed = true;
    const published: number[] = [];
    const storage: CoordinatorStorage = {
      publishRevision: vi.fn(async revision => {
        if (!allowed) throw toRepositoryError(new DOMException('The request is not allowed', 'NotAllowedError'));
        published.push(revision.changes[0]!.after!.value as number);
      }),
      publishNavigation: vi.fn(async () => {}), publishMetadata: vi.fn(async () => {}), publishJournal: vi.fn(async () => {}),
      loadProjection: vi.fn(async () => new Map()), getRevision: vi.fn(async () => null), getRedoChild: vi.fn(async () => null),
      flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
    };
    const coordinator = new ProjectTransactionCoordinator('repo', 'workspace', storage, { canActivate: () => true, activate: async () => {} });
    const edit = (value: number) => { const token = coordinator.begin('Edit'); coordinator.write(token, 'value', entity(value)); return coordinator.commit(token); };

    await coordinator.flush(edit(1).receipt);
    allowed = false;
    const lost = edit(2);
    await expect(coordinator.flush(lost.receipt)).rejects.toMatchObject({ code: 'access' });
    expect(isFolderAccessLossError(coordinator.getStatus().error)).toBe(true);
    // Editing continues while paused; nothing is dropped.
    const later = edit(3);
    expect(coordinator.getStatus()).toMatchObject({ appliedSequence: 3, confirmedSequence: 1 });

    allowed = true;
    await coordinator.retry();
    await coordinator.flush(later.receipt);
    expect(published).toEqual([1, 2, 3]);
    expect(coordinator.getStatus()).toMatchObject({ confirmedSequence: 3, error: null, queuedBytes: 0 });
  });
});
