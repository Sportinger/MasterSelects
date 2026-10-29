// A phone import places its clips first and switches each media to its project copy when the background
// copy is durable. These cases run that switch against a real repository coordinator and the real media
// store: inside the still-open "Add media" batch of a multi-file import, and across Undo/Redo of the
// import. The switch is never an Undo step of its own and must never be lost by one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));
// Source hashing is not under test; it must not race the cases with worker requests.
vi.mock('../../src/services/project/repository/artifacts/queueSourceIdentity', () => ({
  queueSourceIdentity: vi.fn(() => new Promise(() => {})),
}));

import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { switchToProjectCopyWhenDurable } from '../../src/stores/mediaStore/slices/fileImport/backgroundProjectCopy';
import type { ProjectCopySource } from '../../src/stores/mediaStore/helpers/importPipeline';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { getEditorRepositoryWorkspace, installEditorRepositorySession, runEditorBatch, runEditorTransaction, beginEditorTransaction, commitEditorTransaction } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { withRepositoryHydration } from '../../src/services/project/repository/transaction/storeMutationBoundary';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { beginProjectMediaCopy, dismissProjectMediaCopyNotice, getProjectMediaCopyNotice } from '../../src/services/project/mediaCopy/projectMediaCopyNotices';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO, RepositoryProjection } from '../../src/services/project/repository/contracts';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { PENDING_PROJECT_COPIES_VIEW, reportInterruptedProjectMediaCopies } from '../../src/services/project/mediaCopy/pendingProjectCopyMarker';

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
let repositoryCleanup: (() => void) | undefined;

function mediaFile(id: string, file: File | undefined, extra: Partial<MediaFile> = {}): MediaFile {
  return { id, name: `${id}.mp4`, type: 'video', parentId: null, createdAt: 0, file, url: file ? `blob:${id}-original` : '',
    duration: 2, width: 64, height: 64, fps: 25, fileSize: 4, ...extra } as MediaFile;
}

const mediaKey = (id: string) => `media/project/${id}`;
/**
 * The saved project path of media `id`. projectPath is a resolver field: it is kept in the project's
 * workspace views (codec/resolvers/<media key>), not in content revisions, and every activation (Undo,
 * Redo, reopen) reads it from there (editorProjectionActivation workspaceForDecode).
 */
function savedProjectPath(id: string): string | null {
  const view = (getEditorRepositoryWorkspace() as Record<string, { projectPath?: string } | undefined>)[`codec/resolvers/${mediaKey(id)}`];
  return view?.projectPath ?? null;
}

/**
 * A real coordinator over in-memory storage. Its activation does what the editor's does for media:
 * media the target revision does not hold leave the store, media it holds come back (without a runtime
 * file, with the saved project path), so an Undo of the import really removes them.
 */
async function installRepository(options: { updateView?: (key: string) => Promise<number>; workspace?: Record<string, unknown> } = {}) {
  const owner: Composition = { id: 'composition', name: 'Test composition', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, frameRate: 25, duration: 30, backgroundColor: '#000',
    timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ files: [], compositions: [owner], activeCompositionId: owner.id });
  const encoded = encodeProjectDomains({ version: 1, name: 'Background copy', createdAt: '2026-10-28', updatedAt: '2026-10-28',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 }, media: [], folders: [],
    compositions: convertCompositions([owner]), activeCompositionId: owner.id, openCompositionIds: [owner.id], expandedFolderIds: [] });
  const revisions = new Map<string, LogicalRevision>();
  const storage = {
    publishRevision: async (revision: LogicalRevision) => { revisions.set(revision.revisionId, revision); },
    publishNavigation: async () => {}, publishMetadata: async () => {}, publishJournal: async () => {},
    loadProjection: async () => new Map<string, EntityDTO>(), getRevision: async () => null,
    getRedoChild: async (id: string, preferred?: string) => preferred && revisions.get(preferred)?.parentRevisionId === id ? preferred
      : [...revisions.values()].filter(row => row.parentRevisionId === id).at(-1)?.revisionId ?? null,
    flushViews: async () => {}, assertOwned: () => {},
  } as unknown as CoordinatorStorage;
  const activate = async (projection: RepositoryProjection) => {
    const ids = new Set([...projection.entities.keys()].filter(key => key.startsWith('media/project/')).map(key => key.split('/')[2]));
    withRepositoryHydration(() => useMediaStore.setState(state => ({
      files: [...state.files.filter(file => ids.has(file.id)),
        ...[...ids].filter(id => !state.files.some(file => file.id === id))
          .map(id => mediaFile(id, undefined, { projectPath: savedProjectPath(id) ?? undefined }))],
    })));
  };
  const coordinator = new ProjectTransactionCoordinator('background-copy', 'editor', storage, { canActivate: () => true, activate });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: options.updateView ?? (async () => 1) } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session, options.workspace ? { workspace: options.workspace as never } : {});
  const sources = async () => { await coordinator.flush(); return [...revisions.values()].slice(1).map(revision => `${revision.label}:${revision.source}`); };
  return { coordinator, sources };
}

function deferredCopy() {
  let resolve!: (value: ProjectCopySource | null) => void;
  const promise = new Promise<ProjectCopySource | null>(done => { resolve = done; });
  return { promise, resolve };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const media = (id: string) => useMediaStore.getState().files.find(file => file.id === id);
const addMedia = (item: MediaFile) => useMediaStore.setState(state => ({ files: [...state.files, item] }));

beforeEach(() => {
  if (getProjectMediaCopyNotice()) dismissProjectMediaCopyNotice();
});
afterEach(() => {
  repositoryCleanup?.(); repositoryCleanup = undefined;
  useTimelineStore.setState(initialTimeline); useMediaStore.setState(initialMedia);
});

describe('background project copy against the project history', () => {
  it('a copy that finishes while the multi-file "Add media" batch is still open switches after the batch, never as a failure', async () => {
    const { coordinator, sources } = await installRepository();
    const a = new File(['aaaa'], 'm1.mp4'), b = new File(['bbbb'], 'm2.mp4');
    const copyA = deferredCopy(), copyB = deferredCopy();
    const urlCalls: Array<string | undefined> = [];
    const createUrl = async (id: string, file: File) => { urlCalls.push(media(id)?.projectPath); return `blob:copy-of-${file.name}`; };
    const copiedA = new File(['aaaa'], 'm1.mp4'), copiedB = new File(['bbbb'], 'm2.mp4');
    // The copies' notice entries, as processImport hands them over: pending until the switch is recorded.
    const ticketA = beginProjectMediaCopy(a, true, 'background'), ticketB = beginProjectMediaCopy(b, true, 'background');
    let outcomeA!: Promise<string>, outcomeB!: Promise<string>;

    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcomeA = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copyA.promise, { createUrl });
      // File 1's copy is durable while file 2 still imports: the batch owns media m1 until it commits.
      copyA.resolve({ file: copiedA, relativePath: 'Raw/m1.mp4', ticket: ticketA });
      await settle(); await settle();
      addMedia(mediaFile('m2', b, { projectCopy: 'copying' }));
      outcomeB = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm2', b, copyB.promise, { createUrl });
      // Still inside the batch: the media keep the original until the switch can be recorded.
      expect(media('m1')).toMatchObject({ file: a, url: 'blob:m1-original' });
      // Copy 1 is durable but its switch is not recorded yet: the unload guard must still hold.
      expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 2, copiedFiles: 0 });
    });
    copyB.resolve({ file: copiedB, relativePath: 'Raw/m2.mp4', ticket: ticketB });

    await expect(outcomeA).resolves.toBe('switched');
    await expect(outcomeB).resolves.toBe('switched');
    expect(media('m1')).toMatchObject({ file: copiedA, url: 'blob:copy-of-m1.mp4', projectPath: 'Raw/m1.mp4' });
    expect(media('m2')).toMatchObject({ file: copiedB, url: 'blob:copy-of-m2.mp4', projectPath: 'Raw/m2.mp4' });
    expect(media('m1')?.projectCopy).toBeUndefined();
    // The primary URL of the copy replaces the original's only after the switch was recorded.
    expect(urlCalls).toEqual(['Raw/m1.mp4', 'Raw/m2.mp4']);
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 2, failures: [] });
    expect(savedProjectPath('m1')).toBe('Raw/m1.mp4');
    expect(savedProjectPath('m2')).toBe('Raw/m2.mp4');
    // One Undo step for the import. The switch changes the runtime file and the project path (a workspace
    // resolver view); whatever content it changes (a source identity) is a background revision, never a step.
    const [first, ...rest] = await sources();
    expect(first).toBe('Add media:user');
    expect(rest.every(source => source.endsWith(':background'))).toBe(true);
    expect(await coordinator.getNavigationAvailability()).toEqual({ canUndo: true, canRedo: false });
  });

  // projectPath is a resolver field kept in the workspace views, which Undo/Redo do not rewind: a recorded
  // switch survives Undo/Redo of its import. This pins it (the review assumed it lived in the revision).
  it('Undo then Redo of the import keeps the project path of a finished switch', async () => {
    const { coordinator } = await installRepository();
    const a = new File(['aaaa'], 'm1.mp4'), copied = new File(['aaaa'], 'm1.mp4');
    const copy = deferredCopy();
    let outcome!: Promise<string>;
    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcome = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copy.promise,
        { createUrl: async () => 'blob:copy' });
    });
    copy.resolve({ file: copied, relativePath: 'Raw/m1.mp4' });
    await expect(outcome).resolves.toBe('switched');

    expect((await coordinator.undo())?.status).toBe('applied');
    expect(media('m1')).toBeUndefined();
    expect(coordinator.getEntities().has(mediaKey('m1'))).toBe(false);
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    expect(savedProjectPath('m1')).toBe('Raw/m1.mp4');
    expect(media('m1')?.projectPath).toBe('Raw/m1.mp4');
    expect(await coordinator.getNavigationAvailability()).toEqual({ canUndo: true, canRedo: false });
  });

  it('a copy that finishes while the import is undone switches the media when Redo brings them back', async () => {
    const { coordinator } = await installRepository();
    const a = new File(['aaaa'], 'm1.mp4'), copied = new File(['aaaa'], 'm1.mp4');
    const copy = deferredCopy();
    let outcome!: Promise<string>;
    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcome = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copy.promise,
        { createUrl: async () => 'blob:copy' });
    });
    expect((await coordinator.undo())?.status).toBe('applied');
    copy.resolve({ file: copied, relativePath: 'Raw/m1.mp4' });
    await settle();
    expect(media('m1')).toBeUndefined();

    expect((await coordinator.redoRevision())?.status).toBe('applied');
    await expect(outcome).resolves.toBe('switched');
    expect(media('m1')).toMatchObject({ file: copied, projectPath: 'Raw/m1.mp4' });
    expect(savedProjectPath('m1')).toBe('Raw/m1.mp4');
    // And the recorded switch survives the next Undo/Redo, too.
    expect((await coordinator.undo())?.status).toBe('applied');
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    expect(savedProjectPath('m1')).toBe('Raw/m1.mp4');
  });

  it('after a late switch on Redo the timeline clips play the project copy without a reload', async () => {
    const { coordinator } = await installRepository();
    const a = new File(['aaaa'], 'm1.mp4'), copied = new File(['aaaa'], 'm1.mp4');
    const copy = deferredCopy();
    let outcome!: Promise<string>;
    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcome = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copy.promise,
        { createUrl: async () => 'blob:copy' });
    });
    expect((await coordinator.undo())?.status).toBe('applied');
    copy.resolve({ file: copied, relativePath: 'Raw/m1.mp4' });
    await settle();
    expect((await coordinator.redoRevision())?.status).toBe('applied');
    // Redo restores the clips without their runtime file (the media came back without one).
    const track = { id: 'v1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false } as TimelineTrack;
    const clip = { id: 'c1', trackId: 'v1', name: 'm1.mp4', file: undefined, startTime: 0, duration: 2, inPoint: 0, outPoint: 2,
      source: { type: 'video', mediaFileId: 'm1', naturalDuration: 2 }, needsReload: true, isLoading: false,
      transform: {}, effects: [] } as unknown as TimelineClip;
    withRepositoryHydration(() => useTimelineStore.setState({ tracks: [track], clips: [clip] }));

    await expect(outcome).resolves.toBe('switched');
    const restored = useTimelineStore.getState().clips.find(candidate => candidate.id === 'c1');
    expect(restored).toMatchObject({ file: copied, needsReload: false });
  });

  it('keeps the copy pending until its project path is saved, and reports a failed save', async () => {
    let failViews = false;
    let releaseView!: () => void;
    const viewGate = new Promise<void>(resolve => { releaseView = resolve; });
    await installRepository({ updateView: async (key) => {
      if (key.startsWith('codec/resolvers/')) { await viewGate; if (failViews) throw new DOMException('Quota exceeded', 'QuotaExceededError'); }
      return 1;
    } });
    const a = new File(['aaaa'], 'm1.mp4');
    const ticket = beginProjectMediaCopy(a, true, 'background');
    let outcome!: Promise<string>;
    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcome = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a,
        Promise.resolve({ file: new File(['aaaa'], 'm1.mp4'), relativePath: 'Raw/m1.mp4', ticket }), { createUrl: async () => 'blob:copy' });
    });
    await settle(); await settle();
    expect(media('m1')?.projectPath).toBe('Raw/m1.mp4');
    // Recorded in memory, but not saved yet: a reload now would lose it, so the unload guard still holds.
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 1 });
    failViews = true; releaseView();
    await expect(outcome).resolves.toBe('failed');
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 0 });
    expect(getProjectMediaCopyNotice()?.failures).toEqual([{ name: 'm1.mp4', bytes: 4, message: 'browser storage is full' }]);
  });

  it('a copy whose "Add media" batch was cancelled is unused and stops waiting', async () => {
    await installRepository();
    const a = new File(['aaaa'], 'm1.mp4');
    const ticket = beginProjectMediaCopy(a, true, 'background');
    const copy = deferredCopy();
    let outcome!: Promise<string>;
    await expect(runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcome = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copy.promise,
        { createUrl: async () => 'blob:copy' });
      throw new Error('placing the clips failed');
    })).rejects.toThrow('placing the clips failed');
    expect(media('m1')).toBeUndefined();
    copy.resolve({ file: new File(['aaaa'], 'm1.mp4'), relativePath: 'Raw/m1.mp4', ticket });
    await expect(Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('still waiting'), 50))])).resolves.toBe('stale');
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 0 });
  });

  it('a copy whose media were deleted while it ran is not counted as copied', async () => {
    await installRepository();
    const a = new File(['aaaa'], 'm1.mp4');
    const ticket = beginProjectMediaCopy(a, true, 'background');
    const copy = deferredCopy();
    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      void switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copy.promise,
        { createUrl: async () => 'blob:copy' });
    });
    const remove = beginEditorTransaction('Delete media');
    runEditorTransaction(remove, () => useMediaStore.setState(state => ({ files: state.files.filter(file => file.id !== 'm1') })));
    commitEditorTransaction(remove);
    copy.resolve({ file: new File(['aaaa'], 'm1.mp4'), relativePath: 'Raw/m1.mp4', ticket });
    await settle(); await settle();
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 0 });
  });

  it('marks a running copy in the project, so a killed tab can tell on reopen', async () => {
    await installRepository();
    const a = new File(['aaaa'], 'm1.mp4');
    const copy = deferredCopy();
    let outcome!: Promise<string>;
    await runEditorBatch('Add media', async () => {
      addMedia(mediaFile('m1', a, { projectCopy: 'copying' }));
      outcome = switchToProjectCopyWhenDurable(useMediaStore.setState, useMediaStore.getState, 'm1', a, copy.promise,
        { createUrl: async () => 'blob:copy' });
    });
    await settle();
    const pending = () => (getEditorRepositoryWorkspace() as Record<string, unknown>)[PENDING_PROJECT_COPIES_VIEW] as Record<string, unknown> | undefined;
    expect(pending()).toEqual({ m1: { name: 'm1.mp4', bytes: 4 } });
    copy.resolve({ file: new File(['aaaa'], 'm1.mp4'), relativePath: 'Raw/m1.mp4' });
    await expect(outcome).resolves.toBe('switched');
    expect(pending() ?? {}).toEqual({});
  });

  it('on reopen, media whose copy was interrupted are reported, and the marker is cleared', async () => {
    await installRepository({ workspace: { [PENDING_PROJECT_COPIES_VIEW]: { m1: { name: 'm1.mp4', bytes: 4 }, m2: { name: 'm2.mp4', bytes: 8 } } } });
    // m1 never got its project path (the tab died while copying); m2 was switched, only the marker was not cleared.
    useMediaStore.setState(state => ({ files: [...state.files, mediaFile('m1', undefined), mediaFile('m2', undefined, { projectPath: 'Raw/m2.mp4' })] }));
    reportInterruptedProjectMediaCopies();
    await settle();
    expect(getProjectMediaCopyNotice()?.failures).toEqual([{ name: 'm1.mp4', bytes: 4,
      message: 'the copy was interrupted when the page closed', interrupted: true }]);
    expect((getEditorRepositoryWorkspace() as Record<string, unknown>)[PENDING_PROJECT_COPIES_VIEW] ?? {}).toEqual({});
  });
});
