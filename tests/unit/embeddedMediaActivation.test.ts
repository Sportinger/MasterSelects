import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleLinkedMediaConnection, startScheduledLinkedMediaConnection } from '../../src/services/project/repository/transaction/editorLinkedMediaConnection';
import { isLinkedMediaDeferred } from '../../src/services/project/linkedMediaDemand';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

// Live AWS run: after importing a self-contained .msproj, mediaStore files[].file stayed undefined
// (30 s after open) although the originals were stored inside the restored repository.

type MediaEntry = { id: string; name: string; type: string; file?: File; url?: string };
type TestSession = { coordinator: { getProjection(): { entities: Map<string, unknown> } }; client?: Record<string, ReturnType<typeof vi.fn>> };
const mocks = vi.hoisted(() => ({ media: {} as { files: MediaEntry[] } & Record<string, unknown>, timeline: {} as Record<string, unknown>, session: {} as TestSession,
  hydrate: vi.fn(), restore: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../../src/services/project/repository/transaction/storeMutationBoundary', () => ({
  getRepositoryStore: (name: string) => ['media', 'timeline'].includes(name) ? {
    getState: () => name === 'media' ? mocks.media : mocks.timeline,
    setState: (patch: object) => { Object.assign(name === 'media' ? mocks.media : mocks.timeline, patch); for (const fn of mocks.listeners) fn(); },
    subscribe: (fn: () => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn); },
  } : undefined,
  withRepositoryHydration: (run: () => unknown) => run(),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({ getEditorRepositorySession: () => mocks.session,
  withSourceIdentitiesPaused: <T>(action: () => Promise<T>) => action() }));
vi.mock('../../src/services/project/load/loadMediaHydration', () => ({ convertProjectMediaToStore: mocks.hydrate }));
vi.mock('../../src/services/project/repository/transaction/restoreLinkedTimelineMedia', () => ({ restoreLinkedTimelineMedia: mocks.restore }));
vi.mock('../../src/stores/mediaStore/slices/fileManage/timelineClipReload', () => ({ updateTimelineClips: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({ readEditorRepositoryProject: () => ({ media: mocks.media.files }) }));
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({ playheadState: { isUsingInternalPosition: false } }));
vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({ createRenderablePrimaryMediaObjectUrl: async (id: string) => `blob:${id}` }));
vi.mock('../../src/services/project/folderAccess/mediaLocationAccess', () => ({ rememberMediaLocationAccess: vi.fn(), pauseMediaIfAccessLapsed: async () => false }));

const verified = (hash: string) => ({ value: { identityStatus: 'verified', algorithm: 'sha256', contentHash: hash, byteLength: 4 } });
beforeEach(() => {
  scheduleLinkedMediaConnection(null, [], false); mocks.listeners.clear(); vi.clearAllMocks();
  const stored = new Set(['sha256:embedded']);
  mocks.session = {
    coordinator: { getProjection: () => ({ entities: new Map([['source-identity:embedded', verified('sha256:embedded')], ['source-identity:outside', verified('sha256:outside')]]) }) },
    client: {
      hasStoredBlob: vi.fn(async (reference: { hash: string }) => stored.has(reference.hash)),
      readBlob: vi.fn(async (reference: { hash: string }) => stored.has(reference.hash) ? new Blob(['data']) : null),
    },
  };
  mocks.media = { files: ['embedded', 'outside', 'unverified'].map(id => ({ id, name: `${id}.mp4`, type: 'video' })), selectedIds: [], compositions: [], sourceMonitorFileId: null };
  mocks.timeline = { clips: [], playheadPosition: 0, isPlaying: false, isExporting: false };
  mocks.hydrate.mockImplementation(async (items: Array<{ id: string }>) => items.map(item => ({ ...item, file: new File(['data'], item.id) })));
});

describe('embedded originals after project activation', () => {
  it('opens originals stored in the repository without waiting for a clip, and leaves other media on demand', async () => {
    scheduleLinkedMediaConnection(mocks.session as unknown as RepositorySession, mocks.media.files, false);
    startScheduledLinkedMediaConnection();
    await vi.waitFor(() => expect(mocks.media.files[0].file).toBeInstanceOf(File));
    expect(mocks.media.files[0]).toMatchObject({ name: 'embedded.mp4', url: 'blob:embedded' });
    expect(isLinkedMediaDeferred('embedded')).toBe(false);
    // Media outside the repository are neither probed nor marked missing.
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.media.files[1].file).toBeUndefined(); expect(isLinkedMediaDeferred('outside')).toBe(true);
    expect(isLinkedMediaDeferred('unverified')).toBe(true);
    expect(mocks.session.client!.hasStoredBlob).toHaveBeenCalledTimes(2);
  });

  it('does not install an embedded original after the project was switched', async () => {
    let release!: () => void;
    mocks.session.client!.hasStoredBlob = vi.fn(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    const session = mocks.session;
    scheduleLinkedMediaConnection(session as unknown as RepositorySession, mocks.media.files, false);
    startScheduledLinkedMediaConnection();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    mocks.session = { coordinator: { getProjection: () => ({ entities: new Map() }) } };
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(session.client!.readBlob).not.toHaveBeenCalled();
    expect(mocks.media.files[0].file).toBeUndefined();
  });
});
