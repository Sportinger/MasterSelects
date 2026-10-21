import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleLinkedMediaConnection, startScheduledLinkedMediaConnection, prepareTimelineLinkedMedia } from '../../src/services/project/repository/transaction/editorLinkedMediaConnection';
import { isLinkedMediaDeferred, requestLinkedMedia } from '../../src/services/project/linkedMediaDemand';
import { selectDemandedLinkedMedia } from '../../src/services/project/repository/transaction/linkedMediaDemandSelection';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { TimelineClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({ media: {} as Record<string, any>, timeline: {} as Record<string, any>,
  session: {} as any, hydrate: vi.fn(), restore: vi.fn(), listeners: new Set<() => void>() }));
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

const clip = (id: string, startTime: number) => ({ id, mediaFileId: id, source: { type: 'video', mediaFileId: id }, startTime, duration: 10 }) as TimelineClip;
beforeEach(() => {
  scheduleLinkedMediaConnection(null, [], false); mocks.listeners.clear(); vi.clearAllMocks();
  mocks.session = { coordinator: { getProjection: () => ({ entities: new Map() }) } };
  mocks.media = { files: Array.from({ length: 500 }, (_, i) => ({ id: `source-${i}`, type: 'video' })), selectedIds: [], compositions: [], sourceMonitorFileId: null };
  mocks.timeline = { clips: [clip('source-0', 0), clip('source-1', 100)], playheadPosition: 0, isPlaying: false, isExporting: false };
  mocks.hydrate.mockImplementation(async (items: Array<{ id: string }>) => items.map(item => ({ ...item, type: 'video', file: new File(['data'], item.id), url: `blob:${item.id}` })));
});
describe('saved media opened on demand', () => {
  it('opens the current source first, then every composition source, but none of the other 500 library sources', async () => {
    scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
    expect(mocks.hydrate).not.toHaveBeenCalled(); expect(isLinkedMediaDeferred('source-499')).toBe(true);
    startScheduledLinkedMediaConnection();
    await vi.waitFor(() => expect(mocks.media.files[1].file).toBeInstanceOf(File));
    expect(mocks.media.files[0].file).toBeInstanceOf(File);
    expect(mocks.hydrate.mock.calls.map(call => call[0][0].id)).toEqual(['source-0', 'source-1']);
    expect(mocks.hydrate.mock.calls[0][1].trustSavedLocation).toBe(true);
    mocks.media.selectedIds = ['source-99']; for (const fn of mocks.listeners) fn();
    await vi.waitFor(() => expect(mocks.media.files[99].file).toBeInstanceOf(File));
    expect(mocks.hydrate).toHaveBeenCalledTimes(3);
    expect(mocks.media.files[499].file).toBeUndefined(); expect(isLinkedMediaDeferred('source-499')).toBe(true);
  });
  it('checks the sources of a newly opened composition once', async () => {
    scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
    startScheduledLinkedMediaConnection();
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledTimes(2));
    mocks.timeline.clips = [clip('source-7', 500)]; mocks.media.activeCompositionId = 'second';
    for (const fn of mocks.listeners) fn();
    for (const fn of mocks.listeners) fn();
    await vi.waitFor(() => expect(mocks.media.files[7].file).toBeInstanceOf(File));
    expect(mocks.hydrate).toHaveBeenCalledTimes(3);
  });
  it('marks only a failed source offline and deduplicates concurrent requests', async () => {
    mocks.hydrate.mockResolvedValue([{}]);
    scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
    const first = requestLinkedMedia('source-0'), second = requestLinkedMedia('source-0');
    expect(first).toBe(second); expect(await first).toBe(false);
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
    expect(isLinkedMediaDeferred('source-0')).toBe(false);
    expect(mocks.timeline.clips[0].needsReload).toBe(true);
    expect(isLinkedMediaDeferred('source-499')).toBe(true);
  });
  it('export awaits only sources used by the composition', async () => {
    scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
    await prepareTimelineLinkedMedia();
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    expect(mocks.media.files[0].file).toBeInstanceOf(File); expect(mocks.media.files[1].file).toBeInstanceOf(File);
    expect(mocks.media.files[499].file).toBeUndefined();
  });
  it('does not install stale source results after switching project sessions', async () => {
    let release!: (items: unknown[]) => void;
    mocks.hydrate.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
    const pending = requestLinkedMedia('source-0');
    mocks.session = { coordinator: { getProjection: () => ({ entities: new Map() }) } };
    scheduleLinkedMediaConnection(mocks.session, mocks.media.files, false);
    release([{ id: 'source-0', type: 'video', file: new File(['data'], 'old'), url: 'blob:old' }]);
    expect(await pending).toBe(false); expect(mocks.media.files[0].file).toBeUndefined();
    expect(isLinkedMediaDeferred('source-0')).toBe(true);
  });
  it('opens the source again for a reopened session instead of joining the replaced session open', async () => {
    const releases: Array<(items: unknown[]) => void> = [];
    mocks.hydrate.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
    scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
    const stale = requestLinkedMedia('source-0');
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledTimes(1));
    // Fast reopen while the first session is still opening source-0.
    mocks.session = { coordinator: { getProjection: () => ({ entities: new Map() }) } };
    scheduleLinkedMediaConnection(mocks.session, mocks.media.files, false);
    const fresh = requestLinkedMedia('source-0');
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledTimes(2));
    releases[0]([{ id: 'source-0', type: 'video', file: new File(['data'], 'old'), url: 'blob:old' }]);
    expect(await stale).toBe(false);
    releases[1]([{ id: 'source-0', type: 'video', file: new File(['data'], 'new'), url: 'blob:new' }]);
    expect(await fresh).toBe(true);
    expect(mocks.media.files[0].url).toBe('blob:new');
    expect(mocks.timeline.clips[0].needsReload).toBeUndefined();
    expect(isLinkedMediaDeferred('source-0')).toBe(false);
  });
  it('selects active nested media and multicam angles without selecting the entire composition', () => {
    const parent = { ...clip('parent', 5), inPoint: 100, speed: 2, nestedClips: [clip('nested-active', 110), clip('nested-later', 200)] };
    const ids = selectDemandedLinkedMedia([parent, clip('later', 100)], 10, false,
      { version: 1, active: true, groupId: 'g', angles: [{ trackId: 't', label: 'a', sources: [{ mediaFileId: 'angle', startTime: 0, duration: 20, inPoint: 0, template: {} as never }] }] });
    expect([...ids]).toEqual(['parent', 'nested-active', 'angle']);
  });
  it('opens a source once when the playhead demand and the composition check race, so its object URL stays valid', async () => {
    let urlCount = 0;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:primary-${++urlCount}`);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      let release!: (blob: Blob) => void;
      const readBlob = vi.fn(() => new Promise<Blob>(resolve => { release = resolve; }));
      const identity = { value: { identityStatus: 'verified', contentHash: 'hash-0', byteLength: 4 } };
      mocks.session = { client: { readBlob }, coordinator: { getProjection: () => ({ entities: new Map([['source-identity:source-0', identity]]) }) } };
      mocks.media.files = [{ id: 'source-0', type: 'video', name: 'source-0.mp4' }];
      mocks.timeline.clips = [clip('source-0', 0)];
      scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
      startScheduledLinkedMediaConnection();
      // Demand at the playhead and the composition source check both want source-0 now.
      await vi.waitFor(() => expect(readBlob).toHaveBeenCalled());
      await new Promise(resolve => setTimeout(resolve, 0));
      release(new Blob(['data']));
      await vi.waitFor(() => expect(mocks.media.files[0].file).toBeInstanceOf(File));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(readBlob).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      expect(mocks.media.files[0].url).toBe('blob:primary-1');
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });
});
