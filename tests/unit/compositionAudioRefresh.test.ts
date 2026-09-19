import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAddCompClipAction, refreshCompClipNestedDataAction } from '../../src/stores/timeline/clip/compositionClipActions';
import { replaceClipSourceWithCompositionAction } from '../../src/stores/timeline/clip/replaceClipSourceWithCompositionAction';
import { createNestedContentHash } from '../../src/stores/timeline/clip/nestedCompositionContentHash';
import { restoreLoadStateCompositionClip } from '../../src/stores/timeline/serialization/loadStateCompositionClipRestore';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import * as mixdownResources from '../../src/services/timeline/compositionAudioMixdownRuntimeResources';
import * as runtimeCleanup from '../../src/services/timeline/timelineClipSourceRuntimeCleanup';
import * as nestedLoader from '../../src/stores/timeline/nestedCompositionLoader';
import * as deletedClipResources from '../../src/stores/timeline/deletedClipResources';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../src/types';
import type { ClipActionContext } from '../../src/stores/timeline/clip/clipActionContext';

function timelineData(): CompositionTimelineData {
  const { file: _file, source: _source, ...data } = createMockClip({ id: 'inner-audio', trackId: 'a1' });
  return {
    clips: [{ ...data, mediaFileId: 'song', sourceType: 'audio' }],
    tracks: [createMockTrack({ id: 'a1', type: 'audio' })], duration: 60,
    playheadPosition: 0, zoom: 50, scrollX: 0, inPoint: null, outPoint: null, loopPlayback: false,
  };
}

function composition(id: string, data = timelineData()): Composition {
  return { id, name: id, duration: 60, timelineData: data } as Composition;
}

function wrapper(type: 'audio' | 'video', hash: string): TimelineClip {
  return createMockClip({
    id: `wrapper-${type}`, trackId: type === 'audio' ? 'a1' : 'v1',
    source: { type, naturalDuration: 60, ...(type === 'audio' ? { audioElement: document.createElement('audio') } : {}) },
    isComposition: true, compositionId: 'child', nestedContentHash: hash,
    mixdownBuffer: {} as AudioBuffer, mixdownWaveform: [0, 0.4], waveform: [0, 0.4],
    hasMixdownAudio: true, mixdownGenerating: false,
  });
}

function harness(clips: TimelineClip[], compositions: Composition[]) {
  const mediaState = { ...useMediaStore.getState(), compositions };
  vi.spyOn(useMediaStore, 'getState').mockReturnValue(mediaState);
  const state = {
    clips, tracks: [] as ReturnType<typeof createMockTrack>[], timelineSessionId: 1,
    clipKeyframes: new Map(), thumbnailsEnabled: false, invalidateCache: vi.fn(),
    updateDuration: vi.fn(), findNonOverlappingPosition: (_id: string, start: number) => start,
    selectedKeyframeIds: new Set<string>(), keyframeRecordingEnabled: new Set<string>(),
  };
  const context = {
    get: () => state,
    set: (patch: Partial<typeof state> | ((current: typeof state) => Partial<typeof state>)) =>
      Object.assign(state, typeof patch === 'function' ? patch(state) : patch),
  } as unknown as ClipActionContext;
  return { state, context, mediaState };
}

beforeEach(() => {
  vi.spyOn(nestedLoader, 'loadNestedClips').mockResolvedValue([]);
  vi.spyOn(nestedLoader, 'scheduleNestedClipSegmentBuild').mockImplementation(() => {});
  vi.spyOn(runtimeCleanup, 'detachLegacyTimelineMediaElement').mockImplementation(() => {});
  vi.spyOn(runtimeCleanup, 'releaseLegacyTimelineClipSourceRuntimes').mockImplementation(() => {});
  vi.spyOn(mixdownResources, 'releaseCompositionMixdownClipRuntime').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('composition audio refresh', () => {
  it.each([false, true])('invalidates an audio-only wrapper (linked video present: %s)', async (includeVideo) => {
    const child = composition('child');
    const oldHash = createNestedContentHash(child.timelineData);
    const audio = wrapper('audio', oldHash);
    const element = audio.source!.audioElement;
    const clips = includeVideo ? [wrapper('video', oldHash), audio] : [audio];
    child.timelineData!.clips[0].speed = 2;
    child.timelineData!.clips[0].duration = 2.5;
    const { context, state } = harness(clips, [child]);
    await refreshCompClipNestedDataAction(context, 'child');
    const refreshed = state.clips.find(clip => clip.id === audio.id)!;
    expect(refreshed.nestedContentHash).toBe(createNestedContentHash(child.timelineData, [child]));
    expect(refreshed.mixdownBuffer).toBeUndefined();
    expect(refreshed.source?.audioElement).toBeUndefined();
    expect(refreshed.waveform).toBeUndefined();
    expect(refreshed.hasMixdownAudio).toBe(false);
    expect(refreshed.nestedClips).toBeUndefined();
    expect(runtimeCleanup.detachLegacyTimelineMediaElement).toHaveBeenCalledWith(element, { disposeAudioRouting: true });
    expect(mixdownResources.releaseCompositionMixdownClipRuntime).toHaveBeenCalledWith(audio);
    expect(nestedLoader.loadNestedClips).toHaveBeenCalledTimes(includeVideo ? 1 : 0);
  });

  it('retains a ready audio mixdown when only the source composition viewport changed', async () => {
    const child = composition('child');
    const audio = wrapper('audio', createNestedContentHash(child.timelineData));
    child.timelineData!.zoom = 120;
    const { context, state } = harness([audio], [child]);
    await refreshCompClipNestedDataAction(context, 'child');
    expect(state.clips[0].mixdownBuffer).toBe(audio.mixdownBuffer);
    expect(state.clips[0].source?.audioElement).toBe(audio.source?.audioElement);
    expect(mixdownResources.releaseCompositionMixdownClipRuntime).not.toHaveBeenCalled();
  });

  it('invalidates a grandparent audio wrapper after an inner source edit', async () => {
    const child = composition('child');
    const parent = composition('parent');
    parent.timelineData!.clips[0] = { ...parent.timelineData!.clips[0], isComposition: true, compositionId: 'child' };
    const compositions = [child, parent];
    const audio = { ...wrapper('audio', createNestedContentHash(parent.timelineData, compositions)), compositionId: 'parent' };
    child.timelineData!.tracks[0].muted = true;
    const { context, state } = harness([audio], compositions);
    await refreshCompClipNestedDataAction(context, 'child');
    expect(state.clips[0].mixdownBuffer).toBeUndefined();
    expect(state.clips[0].nestedContentHash).not.toBe(audio.nestedContentHash);
  });

  it('discards an older video refresh without replacing newer nested content or linked audio', async () => {
    const child = composition('child');
    const oldHash = createNestedContentHash(child.timelineData);
    child.timelineData!.clips[0].speed = 2;
    const { context, state, mediaState } = harness([wrapper('video', oldHash), wrapper('audio', oldHash)], [child]);
    state.thumbnailsEnabled = true;
    let finishOldLoad!: (clips: TimelineClip[]) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const oldLoad = new Promise<TimelineClip[]>(resolve => { finishOldLoad = resolve; });
    const oldNestedClips = [createMockClip({ id: 'old-nested' })];
    const newNestedClips = [createMockClip({ id: 'new-nested' })];
    vi.mocked(nestedLoader.loadNestedClips)
      .mockImplementationOnce(() => { signalStarted(); return oldLoad; })
      .mockResolvedValueOnce(newNestedClips);

    const firstRefresh = refreshCompClipNestedDataAction(context, 'child');
    await started;
    const newerChild = composition('child');
    newerChild.timelineData!.clips[0].speed = 3;
    mediaState.compositions = [newerChild];
    await refreshCompClipNestedDataAction(context, 'child');
    const newerHash = createNestedContentHash(newerChild.timelineData, [newerChild]);
    const readyBuffer = {} as AudioBuffer;
    state.clips = state.clips.map(clip => ({ ...clip, mixdownBuffer: readyBuffer, hasMixdownAudio: true }));

    finishOldLoad(oldNestedClips);
    await firstRefresh;
    expect(state.clips.map(clip => clip.nestedContentHash)).toEqual([newerHash, newerHash]);
    expect(state.clips.every(clip => clip.mixdownBuffer === readyBuffer && clip.hasMixdownAudio)).toBe(true);
    expect(state.clips[0].nestedClips).toBe(newNestedClips);
    expect(vi.mocked(nestedLoader.loadNestedClips).mock.calls[0][0].isCurrentTimelineSession?.()).toBe(false);
    expect(nestedLoader.scheduleNestedClipSegmentBuild).toHaveBeenCalledTimes(1);
    expect(runtimeCleanup.releaseLegacyTimelineClipSourceRuntimes).toHaveBeenCalledWith(oldNestedClips, {
      disposeAudioRouting: true, recurseNestedClips: true, releaseVectorRuntime: false,
    });
    expect(mixdownResources.releaseCompositionMixdownClipRuntime).toHaveBeenCalledTimes(2);
  });

  it('rejects a changed source revision even before its next refresh starts', async () => {
    const child = composition('child');
    const oldHash = createNestedContentHash(child.timelineData);
    const video = wrapper('video', oldHash);
    const { context, state, mediaState } = harness([video], [child]);
    vi.mocked(nestedLoader.loadNestedClips).mockImplementationOnce(async () => {
      const editedChild = composition('child');
      editedChild.timelineData!.tracks[0].muted = true;
      mediaState.compositions = [editedChild];
      return [];
    });
    await refreshCompClipNestedDataAction(context, 'child');
    expect(state.clips[0]).toBe(video);
    expect(runtimeCleanup.releaseLegacyTimelineClipSourceRuntimes).toHaveBeenCalledTimes(1);
    expect(mixdownResources.releaseCompositionMixdownClipRuntime).not.toHaveBeenCalled();
  });

  it.each(['add', 'restore', 'replace'] as const)('does not let an older %s overwrite a later refresh', async (operation) => {
    const child = composition('child');
    const original = createMockClip({ id: 'original', trackId: 'v1', source: { type: 'video', naturalDuration: 60 } });
    const { context, state, mediaState } = harness(operation === 'replace' ? [original] : [], [child]);
    state.tracks = [createMockTrack({ id: 'v1', type: 'video' })];
    mediaState.activeCompositionId = null;
    vi.spyOn(deletedClipResources, 'cleanupDeletedClipResources').mockImplementation(() => {});
    let finishOldLoad!: (clips: TimelineClip[]) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const oldLoad = new Promise<TimelineClip[]>(resolve => { finishOldLoad = resolve; });
    const oldNested = [createMockClip({ id: 'old-nested' })];
    const newNested = [createMockClip({ id: 'new-nested' })];
    vi.mocked(nestedLoader.loadNestedClips)
      .mockImplementationOnce(() => { signalStarted(); return oldLoad; })
      .mockResolvedValueOnce(newNested);
    let firstInstall: Promise<unknown>;
    if (operation === 'add') {
      firstInstall = applyAddCompClipAction(context, 'v1', child, 0);
    } else if (operation === 'replace') {
      firstInstall = replaceClipSourceWithCompositionAction(context, original.id, child.id);
    } else {
      const { source: _source, file: _file, ...serialized } = wrapper('video', 'old');
      firstInstall = restoreLoadStateCompositionClip({
        serializedClip: { ...serialized, sourceType: 'video', mediaFileId: '' },
        mediaStore: mediaState, get: context.get, set: context.set,
        pushRestoredClip: clip => { state.clips.push(clip); }, flushRestoredClipBuffer: vi.fn(),
        isCurrentTimelineSession: () => true, wakePreviewAfterRestore: vi.fn(), restoreSourceThumbnails: vi.fn(),
      });
    }
    await started;
    const videoId = state.clips.find(clip => clip.source?.type === 'video')!.id;
    const audioCount = operation === 'restore' ? 0 : 1;
    expect(state.clips.filter(clip => clip.source?.type === 'audio')).toHaveLength(audioCount);
    const newerChild = composition('child');
    newerChild.timelineData!.clips[0].speed = 3;
    mediaState.compositions = [newerChild];
    state.thumbnailsEnabled = true;
    await refreshCompClipNestedDataAction(context, child.id);
    finishOldLoad(oldNested);
    await firstInstall;
    const currentVideo = state.clips.find(clip => clip.id === videoId)!;
    expect(currentVideo.nestedClips).toBe(newNested);
    expect(currentVideo.nestedContentHash).toBe(createNestedContentHash(newerChild.timelineData, [newerChild]));
    expect(state.clips.filter(clip => clip.source?.type === 'audio')).toHaveLength(audioCount);
    expect(nestedLoader.scheduleNestedClipSegmentBuild).toHaveBeenCalledTimes(1);
    expect(vi.mocked(nestedLoader.loadNestedClips).mock.calls[0][0].isCurrentTimelineSession?.()).toBe(false);
    expect(runtimeCleanup.releaseLegacyTimelineClipSourceRuntimes).toHaveBeenCalledWith(oldNested, {
      disposeAudioRouting: true, recurseNestedClips: true, releaseVectorRuntime: false,
    });
  });

  it.each(['audio', 'video'] as const)('restores %s wrappers with the current source identity', async (sourceType) => {
    const child = composition('child');
    const { context, state, mediaState } = harness([], [child]);
    const { source: _source, file: _file, ...data } = wrapper(sourceType, 'old');
    const serialized = { ...data, mediaFileId: '', sourceType } as SerializableClip;
    await restoreLoadStateCompositionClip({
      serializedClip: serialized, mediaStore: mediaState, get: context.get, set: context.set,
      pushRestoredClip: clip => { state.clips.push(clip); }, flushRestoredClipBuffer: vi.fn(),
      isCurrentTimelineSession: () => true, wakePreviewAfterRestore: vi.fn(), restoreSourceThumbnails: vi.fn(),
    });
    expect(state.clips[0].nestedContentHash).toBe(createNestedContentHash(child.timelineData, [child]));
    expect(state.clips[0].mixdownBuffer).toBeUndefined();
  });
});
