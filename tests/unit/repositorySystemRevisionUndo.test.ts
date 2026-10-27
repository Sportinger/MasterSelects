import { describe, it, expect, vi } from 'vitest';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type CoordinatorActivation, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { isSystemRevisionSource } from '../../src/services/project/repository/transaction/historyNavigationPlan';
import type { RevisionMetadata, EntityDTO, RepositoryProjection } from '../../src/services/project/repository/contracts';

function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const entity = (value: number): EntityDTO => ({ type: 'fixture', schemaVersion: 1, value, references: [], blobs: [] });
function fixture(activate: CoordinatorActivation['activate'] = async () => {}) {
  const revisions = new Map<string, LogicalRevision>(), projections = new Map<string, ReadonlyMap<string, EntityDTO>>();
  const metadata = (id: string): RevisionMetadata | null => {
    const revision = revisions.get(id); return revision ? { ...revision,
      reference: { hash: 'sha256:' + '0'.repeat(64), segmentId: 'test', offset: 8, length: 1 }, operationSequence: 1, changedEntities: revision.changes.map(change => change.entityKey) } : null;
  };
  const storage: CoordinatorStorage = {
    publishRevision: vi.fn(async revision => { const projection = new Map(revision.parentRevisionId ? projections.get(revision.parentRevisionId) : []);
      for (const change of revision.changes) if (change.after) projection.set(change.entityKey, change.after); else projection.delete(change.entityKey);
      revisions.set(revision.revisionId, revision); projections.set(revision.revisionId, projection); }),
    publishNavigation: vi.fn(async () => {}), publishMetadata: vi.fn(async () => {}), publishJournal: vi.fn(async () => {}),
    loadProjection: vi.fn(async id => projections.get(id) ?? new Map()), getRevision: vi.fn(async id => metadata(id)),
    // Like the worker index: the preferred child when it is one, otherwise the newest child.
    getRedoChild: vi.fn(async (id, preferred) => preferred && revisions.get(preferred)?.parentRevisionId === id ? preferred
      : [...revisions.values()].filter(row => row.parentRevisionId === id).at(-1)?.revisionId ?? null),
    flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
  };
  const activation = { canActivate: () => true, activate: vi.fn(activate) };
  const coordinator = new ProjectTransactionCoordinator('repo', 'workspace', storage, activation);
  const write = (target: ProjectTransactionCoordinator, key: string, value: number, source = 'user') => {
    const token = target.begin(source === 'user' ? 'Edit' : 'Verify media source', source); target.write(token, key, entity(value)); return target.commit(token);
  };
  const reopen = (revisionId: string) => {
    const reopened = new ProjectTransactionCoordinator('repo', 'fresh', storage, { canActivate: () => true, activate: async () => {} });
    reopened.restore({ revisionId, generation: 0, entities: new Map(projections.get(revisionId)) }, coordinator.getStatus().confirmedSequence);
    return reopened;
  };
  return { coordinator, storage, activation, revisions, projections, write, reopen };
}
const value = (coordinator: ProjectTransactionCoordinator, key: string) => coordinator.getEntities().get(key)?.value;
const availability = (coordinator: ProjectTransactionCoordinator) => coordinator.getNavigationAvailability();

describe('system revisions stay out of the undo chain', () => {
  it('names the system sources', () => {
    expect(['source-identity', 'background', 'artifact'].every(isSystemRevisionSource)).toBe(true);
    expect(['user', 'gesture', 'import', 'project', undefined].some(isSystemRevisionSource)).toBe(false);
  });
  it('one Undo takes back the user edit under a later system revision and keeps the system data', async () => {
    const { coordinator, activation, write, revisions } = fixture();
    write(coordinator, 'clip', 1); const edit = write(coordinator, 'clip', 2);
    const verify = write(coordinator, 'source-identity:media', 7, 'source-identity');
    expect(await availability(coordinator)).toEqual({ canUndo: true, canRedo: false });
    expect((await coordinator.undo())?.status).toBe('applied');
    expect(value(coordinator, 'clip')).toBe(1);
    expect(value(coordinator, 'source-identity:media')).toBe(7);
    // The activated runtime already received the carried value, so the screen matches the repository.
    const activated = activation.activate.mock.calls.at(-1)![0] as RepositoryProjection;
    expect(activated.entities.get('source-identity:media')?.value).toBe(7);
    expect(activated.entities.get('clip')?.value).toBe(1);
    expect(await availability(coordinator)).toEqual({ canUndo: false, canRedo: true });
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    expect(value(coordinator, 'clip')).toBe(2);
    expect(value(coordinator, 'source-identity:media')).toBe(7);
    expect(await availability(coordinator)).toEqual({ canUndo: true, canRedo: false });
    await coordinator.flush();
    // The verify revision keeps its durable row; the carried values are recorded as system revisions.
    expect(revisions.get(verify.revisionId!)?.source).toBe('source-identity');
    expect([...revisions.values()].filter(row => row.label === 'Keep background changes').every(row => row.source === 'background')).toBe(true);
    expect(edit.revisionId).not.toBe(coordinator.getStatus().revisionId);
  });
  it('walks Undo and Redo across a system revision between two user edits', async () => {
    const { coordinator, write } = fixture();
    write(coordinator, 'clip', 0); write(coordinator, 'clip', 1);
    write(coordinator, 'source-identity:media', 7, 'source-identity');
    write(coordinator, 'clip', 2);
    for (const expected of [1, 0]) { expect((await coordinator.undo())?.status).toBe('applied'); expect(value(coordinator, 'clip')).toBe(expected); }
    expect(await availability(coordinator)).toEqual({ canUndo: false, canRedo: true });
    for (const expected of [1, 2]) { expect((await coordinator.redoRevision())?.status).toBe('applied'); expect(value(coordinator, 'clip')).toBe(expected); }
    expect(value(coordinator, 'source-identity:media')).toBe(7);
    expect(await availability(coordinator)).toEqual({ canUndo: true, canRedo: false });
  });
  it('redoes the edit from a system revision that sits on the undo target', async () => {
    const { coordinator, write } = fixture();
    write(coordinator, 'clip', 0); write(coordinator, 'source-identity:a', 1, 'source-identity');
    write(coordinator, 'clip', 1); write(coordinator, 'source-identity:b', 2, 'background');
    expect((await coordinator.undo())?.status).toBe('applied');
    expect(value(coordinator, 'clip')).toBe(0);
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    expect(value(coordinator, 'clip')).toBe(1);
    expect([value(coordinator, 'source-identity:a'), value(coordinator, 'source-identity:b')]).toEqual([1, 2]);
  });
  it('a system revision after an Undo keeps the undone edit redoable', async () => {
    const { coordinator, write } = fixture();
    write(coordinator, 'clip', 1); write(coordinator, 'clip', 2);
    expect((await coordinator.undo())?.status).toBe('applied');
    write(coordinator, 'source-identity:media', 7, 'source-identity');
    expect(await availability(coordinator)).toMatchObject({ canRedo: true });
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    expect(value(coordinator, 'clip')).toBe(2);
    expect(value(coordinator, 'source-identity:media')).toBe(7);
  });
  it('a new user edit after an Undo still replaces the redo branch, also above a system revision', async () => {
    const { coordinator, write } = fixture();
    write(coordinator, 'clip', 0); write(coordinator, 'clip', 1); write(coordinator, 'clip', 2);
    expect((await coordinator.undo())?.status).toBe('applied');
    write(coordinator, 'source-identity:media', 7, 'source-identity');
    write(coordinator, 'clip', 3);
    expect(await availability(coordinator)).toEqual({ canUndo: true, canRedo: false });
    for (const expected of [1, 0]) { expect((await coordinator.undo())?.status).toBe('applied'); expect(value(coordinator, 'clip')).toBe(expected); }
    for (const expected of [1, 3]) { expect((await coordinator.redoRevision())?.status).toBe('applied'); expect(value(coordinator, 'clip')).toBe(expected); }
    expect(value(coordinator, 'source-identity:media')).toBe(7);
    expect(await availability(coordinator)).toEqual({ canUndo: true, canRedo: false });
  });
  it('system revisions alone are no undo step', async () => {
    const { coordinator, write } = fixture();
    write(coordinator, 'clip', 1); write(coordinator, 'source-identity:media', 7, 'source-identity');
    expect(await availability(coordinator)).toEqual({ canUndo: false, canRedo: false });
    expect(await coordinator.undo()).toBeNull();
    expect(coordinator.getStatus().navigation).toBe('idle');
    expect(value(coordinator, 'source-identity:media')).toBe(7);
  });
  it('drops a system revision about the object the undone step created', async () => {
    const { coordinator, write } = fixture();
    write(coordinator, 'clip', 1); write(coordinator, 'media', 1);
    write(coordinator, 'media', 2, 'background');
    expect((await coordinator.undo())?.status).toBe('applied');
    expect(coordinator.getEntities().has('media')).toBe(false);
    expect(value(coordinator, 'clip')).toBe(1);
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    expect(value(coordinator, 'media')).toBe(1);
  });
  it('plans over durable history in a reopened session', async () => {
    const { coordinator, write, reopen } = fixture();
    write(coordinator, 'clip', 1); write(coordinator, 'clip', 2);
    const verify = write(coordinator, 'source-identity:media', 7, 'source-identity'); await coordinator.flush(verify.receipt);
    const reopened = reopen(verify.revisionId!);
    expect(await availability(reopened)).toEqual({ canUndo: true, canRedo: false });
    expect((await reopened.undo())?.status).toBe('applied');
    expect([value(reopened, 'clip'), value(reopened, 'source-identity:media')]).toEqual([1, 7]);
  });
  it('a system commit while Undo loads neither cancels the Undo nor loses its data', async () => {
    const { coordinator, storage, write, reopen } = fixture();
    write(coordinator, 'clip', 1); const edit = write(coordinator, 'clip', 2); await coordinator.flush(edit.receipt);
    // A reopened session has no local undo cache, so Undo loads the target from storage.
    const reopened = reopen(edit.revisionId!);
    const entered = deferred(), release = deferred(); const load = storage.loadProjection;
    storage.loadProjection = vi.fn(async (id, signal) => { entered.resolve(); await release.promise; return load(id, signal); });
    const undo = reopened.undo(); await entered.promise;
    write(reopened, 'source-identity:media', 7, 'source-identity');
    release.resolve();
    expect((await undo)?.status).toBe('applied');
    expect(value(reopened, 'clip')).toBe(1);
    expect(value(reopened, 'source-identity:media')).toBe(7);
    expect(reopened.getStatus().navigation).toBe('idle');
  });
  it('a system writer waiting for navigation commits after the Undo instead of failing in its activation', async () => {
    const entered = deferred(), release = deferred();
    const { coordinator, write } = fixture(async () => { entered.resolve(); await release.promise; });
    write(coordinator, 'clip', 1); write(coordinator, 'clip', 2);
    const undo = coordinator.undo(); await entered.promise;
    expect(() => write(coordinator, 'x', 1, 'source-identity')).toThrow(); // activation window stays guarded
    const background = coordinator.whenNavigationIdle().then(() => write(coordinator, 'source-identity:media', 7, 'source-identity'));
    release.resolve();
    expect((await undo)?.status).toBe('applied'); await background;
    expect(value(coordinator, 'clip')).toBe(1);
    expect(value(coordinator, 'source-identity:media')).toBe(7);
    expect(await availability(coordinator)).toEqual({ canUndo: false, canRedo: true });
  });
  it('a user edit still cancels a running Undo', async () => {
    const { coordinator, write, storage, reopen } = fixture();
    write(coordinator, 'clip', 1); const edit = write(coordinator, 'clip', 2); await coordinator.flush(edit.receipt);
    const reopened = reopen(edit.revisionId!);
    const entered = deferred(), release = deferred(); const load = storage.loadProjection;
    storage.loadProjection = vi.fn(async (id, signal) => { entered.resolve(); await release.promise; return load(id, signal); });
    const undo = reopened.undo(); await entered.promise;
    write(reopened, 'clip', 3); release.resolve();
    expect(await undo).toMatchObject({ status: 'cancelled' });
    expect(value(reopened, 'clip')).toBe(3);
  });
});
