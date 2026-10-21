import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleLinkedMediaConnection, prepareTimelineLinkedMedia } from '../../src/services/project/repository/transaction/editorLinkedMediaConnection';
import { isLinkedMediaDeferred, requestLinkedMedia } from '../../src/services/project/linkedMediaDemand';
import { pauseMediaAccess, resetFolderAccessPause, takePausedMedia, canPauseMediaAccess } from '../../src/services/project/folderAccess/folderAccessPause';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { TimelineClip } from '../../src/types/timeline';

interface MediaFixture { files: Array<{ id: string; name: string; type: string; file?: File }>; selectedIds: string[]; compositions: unknown[]; sourceMonitorFileId: null }
interface TimelineFixture { clips: Array<TimelineClip & { needsReload?: boolean }>; playheadPosition: number; isPlaying: boolean; isExporting: boolean }
const mocks = vi.hoisted(() => ({ media: {} as MediaFixture, timeline: {} as TimelineFixture,
  session: {} as unknown, hydrate: vi.fn(), lapsed: true, remembered: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/storeMutationBoundary', () => ({
  getRepositoryStore: (name: string) => ['media', 'timeline'].includes(name) ? {
    getState: () => name === 'media' ? mocks.media : mocks.timeline,
    setState: (patch: object) => { Object.assign(name === 'media' ? mocks.media : mocks.timeline, patch); },
    subscribe: () => () => {},
  } : undefined,
  withRepositoryHydration: (run: () => unknown) => run(),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({ getEditorRepositorySession: () => mocks.session,
  withSourceIdentitiesPaused: <T>(action: () => Promise<T>) => action() }));
vi.mock('../../src/services/project/load/loadMediaHydration', () => ({ convertProjectMediaToStore: mocks.hydrate }));
vi.mock('../../src/services/project/repository/transaction/restoreLinkedTimelineMedia', () => ({ restoreLinkedTimelineMedia: vi.fn() }));
vi.mock('../../src/stores/mediaStore/slices/fileManage/timelineClipReload', () => ({ updateTimelineClips: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({ readEditorRepositoryProject: () => ({ media: mocks.media.files }) }));
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({ playheadState: { isUsingInternalPosition: false } }));
// The real check queries stored handles; here the browser either paused access or the file is gone.
vi.mock('../../src/services/project/folderAccess/mediaLocationAccess', async () => {
  const pause = await import('../../src/services/project/folderAccess/folderAccessPause');
  return {
    pauseMediaIfAccessLapsed: async (media: { id: string }) => {
      if (!mocks.lapsed || !pause.canPauseMediaAccess(media.id)) return false;
      pause.pauseMediaAccess(media.id); return true;
    },
    rememberMediaLocationAccess: mocks.remembered,
  };
});

const clip = (id: string) => ({ id, mediaFileId: id, source: { type: 'video', mediaFileId: id }, startTime: 0, duration: 10 }) as TimelineClip;
beforeEach(() => {
  vi.clearAllMocks(); mocks.lapsed = true;
  mocks.session = { location: { kind: 'opfs', path: 'p' }, coordinator: { getProjection: () => ({ entities: new Map() }) } };
  mocks.media = { files: [{ id: 'clip-a', name: 'a.mov', type: 'video' }], selectedIds: [], compositions: [], sourceMonitorFileId: null };
  mocks.timeline = { clips: [clip('clip-a')], playheadPosition: 0, isPlaying: false, isExporting: false };
  scheduleLinkedMediaConnection(mocks.session as RepositorySession, mocks.media.files, false);
});
afterEach(() => resetFolderAccessPause());

describe('media whose folder access the browser paused', () => {
  it('stays unopened instead of offline, so the relink dialog does not open, and opens after Re-allow', async () => {
    mocks.hydrate.mockResolvedValue([{}]);
    expect(await requestLinkedMedia('clip-a')).toBe(false);
    expect(isLinkedMediaDeferred('clip-a')).toBe(true);
    expect(mocks.timeline.clips[0].needsReload).toBeUndefined();
    // Deferred media never count as needing a relink (mediaNeedsRelink), so the reconnect dialog stays closed.
    // While paused, playhead and selection updates do not probe the location again.
    expect(await requestLinkedMedia('clip-a')).toBe(false);
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
    // Export explains the pause instead of asking for a relink.
    await expect(prepareTimelineLinkedMedia()).rejects.toThrow(/Re-allow/);

    // Re-allow hands the media back; the opener is not cached and reads it now.
    mocks.hydrate.mockImplementation(async (items: Array<{ id: string }>) => items.map(item => ({ ...item, type: 'video', file: new File(['x'], item.id), url: `blob:${item.id}` })));
    expect(takePausedMedia()).toEqual(['clip-a']);
    expect(await requestLinkedMedia('clip-a')).toBe(true);
    expect(mocks.media.files[0].file).toBeInstanceOf(File);
    expect(isLinkedMediaDeferred('clip-a')).toBe(false);
    await vi.waitFor(() => expect(mocks.remembered).toHaveBeenCalledWith(expect.objectContaining({ id: 'clip-a' })));
  });

  it('goes offline as before when the file is really gone or Re-allow did not restore it', async () => {
    mocks.hydrate.mockResolvedValue([{}]);
    pauseMediaAccess('clip-a'); takePausedMedia();
    expect(canPauseMediaAccess('clip-a')).toBe(false);
    expect(await requestLinkedMedia('clip-a')).toBe(false);
    expect(isLinkedMediaDeferred('clip-a')).toBe(false);
    expect(mocks.timeline.clips[0].needsReload).toBe(true);
  });
});
