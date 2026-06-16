// Timeline serialization utilities - save, load, clear
// Extracted from index.ts for maintainability

import type { SliceCreator, TimelineClip, TimelineTrack, TimelineUtils, Keyframe, CompositionTimelineData } from './types';
import { DEFAULT_TRACKS } from './constants';
import { useMediaStore } from '../mediaStore';
import { renderHostPort } from '../../services/render/renderHostPort';
import { layerBuilder } from '../../services/layerBuilder';
import { videoBakeProxyCache } from '../../services/videoBakeProxyCache';
import { sanitizePlayheadPosition } from '../../services/layerBuilder/PlayheadState';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { clearAINodeRuntimeCache } from '../../services/nodeGraph';
import { runtimeAudioMeterBus } from '../../services/audio/runtimeAudioMeterBus';
import { withProjectStoreSyncGuard } from '../../services/project/projectStoreSyncGuard';
import {
  resetVolatileVideoBakeRegionStatuses,
} from './videoBakeSlice';
import { releaseAllLazyTimelineMediaElements } from '../../services/timeline/lazyMediaElements';
import { releaseAllLazyTimelineImageElements } from '../../services/timeline/lazyImageElements';
import { releaseLegacyTimelineClipSourceRuntimes } from '../../services/timeline/timelineClipSourceRuntimeCleanup';
import { blobUrlManager } from './helpers/blobUrlManager';
import { createSerializableTimelineState } from './serialization/serializableTimelineState';
import { createLoadStateGeneratedClip } from './serialization/loadStateGeneratedClipRestore';
import { restoreLoadStateCompositionClip } from './serialization/loadStateCompositionClipRestore';
import { restoreLoadStateMediaClip } from './serialization/loadStateMediaClipRestore';
import { createDefaultRulerLaneState, normalizeRulerLaneState } from '../../timeline/tempo/rulerDefaults';

function getDefaultExpandedTrackIds(tracks: readonly TimelineTrack[]): string[] {
  return tracks.map(track => track.id);
}

function restoreSourceThumbnails(
  mediaFileId: string | undefined,
): void {
  if (!mediaFileId) {
    return;
  }

  const fileHash = useMediaStore.getState().files.find(f => f.id === mediaFileId)?.fileHash;
  void thumbnailCacheService.loadCachedForSource(mediaFileId, fileHash);
}

type SerializationUtils = Pick<TimelineUtils, 'getSerializableState' | 'loadState' | 'clearTimeline'>;

const RESTORE_STATE_YIELD_INTERVAL = 64;

export const createSerializationUtils: SliceCreator<SerializationUtils> = (set, get) => ({
  // Get serializable timeline state for saving to composition
  getSerializableState: (): CompositionTimelineData => createSerializableTimelineState(get()),
  // Load timeline state from composition data
  loadState: async (data: CompositionTimelineData | undefined) => {
    // Suppress autosave for the ENTIRE restore (incl. the chunked yields below) so
    // a partially-loaded timeline can never be persisted over the full project.
    // The depth-counter guard holds across awaits/yields (issue #228 data-loss guard).
    return withProjectStoreSyncGuard(async () => {
    const { pause, clearTimeline } = get();
    const wakePreviewAfterRestore = () => {
      layerBuilder.invalidateCache();
      renderHostPort.requestRender();
    };
    // Stop playback
    pause();

    // Clear current timeline
    videoBakeProxyCache.clear();
    clearTimeline();
    const timelineSessionId = get().timelineSessionId;
    const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId;

    if (!data) {
      // No data - start with fresh default timeline
      set({
        tracks: DEFAULT_TRACKS.map(t => ({ ...t })),
        clips: [],
        playheadPosition: 0,
        duration: 60,
        durationLocked: false,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
        playbackSpeed: 1,
        selectedClipIds: new Set(),
        primarySelectedClipId: null,
        propertiesSelection: null,
        transitionEditPreview: null,
        targetTrackIdByType: {},
        markers: [],
        ...createDefaultRulerLaneState(),
        videoBakeRegionSelection: null,
        videoBakeRegions: [],
        masterAudioState: undefined,
        clipStemSeparationJobs: {},
      });
      return;
    }

    // Restore tracks and basic state
    // Increment animation key to trigger entrance animations on clips
    const { clipEntranceAnimationKey } = get();
    const safePlayheadPosition = sanitizePlayheadPosition(data.playheadPosition, 0);
    const restoredVideoBakeState = resetVolatileVideoBakeRegionStatuses(
      [],
      data.videoBakeRegions ?? [],
    );

    set({
      tracks: data.tracks.map(t => ({ ...t })),
      clips: [], // We'll restore clips separately
      playheadPosition: safePlayheadPosition,
      duration: data.duration,
      durationLocked: data.durationLocked || false,
      zoom: data.zoom,
      scrollX: data.scrollX,
      inPoint: data.inPoint,
      outPoint: data.outPoint,
      loopPlayback: data.loopPlayback,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      transitionEditPreview: null,
      targetTrackIdByType: {},
      // Clear keyframe state
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(getDefaultExpandedTrackIds(data.tracks)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      clipStemSeparationJobs: {},
      // Restore markers
      markers: data.markers || [],
      // Restore ruler lanes / tempo map, defaulting old comps (issue #257). This
      // is the composition-switch seam — fields dropped here vanish on comp swap.
      ...normalizeRulerLaneState({
        tempoMap: data.tempoMap,
        rulerLanes: data.rulerLanes,
        activeRulerLaneId: data.activeRulerLaneId,
      }),
      videoBakeRegionSelection: null,
      videoBakeRegions: restoredVideoBakeState.videoBakeRegions,
      masterAudioState: data.masterAudioState ? structuredClone(data.masterAudioState) : undefined,
      // Increment animation key for clip entrance animations
      clipEntranceAnimationKey: clipEntranceAnimationKey + 1,
    });

    // Restore keyframes from serialized clips
    const keyframeMap = new Map<string, Keyframe[]>();
    for (const serializedClip of data.clips) {
      if (serializedClip.keyframes && serializedClip.keyframes.length > 0) {
        keyframeMap.set(serializedClip.id, serializedClip.keyframes);
      }
    }
    if (keyframeMap.size > 0) {
      set({ clipKeyframes: keyframeMap });
    }

    // Restore clips - need to recreate media elements from file references
    const mediaStore = useMediaStore.getState();
    const restoredClipBuffer: TimelineClip[] = [];
    const flushRestoredClipBuffer = () => {
      if (restoredClipBuffer.length === 0) {
        return;
      }
      const nextClips = restoredClipBuffer.splice(0);
      set(state => ({
        clips: [...state.clips, ...nextClips],
      }));
    };
    const pushRestoredClip = (clip: TimelineClip) => {
      restoredClipBuffer.push(clip);
      if (restoredClipBuffer.length >= 128) {
        flushRestoredClipBuffer();
      }
    };
    const patchRestoredClip = (clipId: string, updater: (clip: TimelineClip) => TimelineClip) => {
      const bufferedIndex = restoredClipBuffer.findIndex((candidate) => candidate.id === clipId);
      if (bufferedIndex >= 0) {
        restoredClipBuffer[bufferedIndex] = updater(restoredClipBuffer[bufferedIndex]);
        return;
      }
      set(state => ({
        clips: state.clips.map(c => c.id === clipId ? updater(c) : c),
      }));
    };

    let restoreYieldCounter = 0;
    for (const serializedClip of data.clips) {
      // Yield every few clips so a large comp loads in responsive chunks instead of
      // one long task that freezes the whole tab. Safe now: autosave is suppressed by
      // the withProjectStoreSyncGuard wrapper around this restore (issue #228).
      if (++restoreYieldCounter % RESTORE_STATE_YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const compositionResult = await restoreLoadStateCompositionClip({
        serializedClip,
        mediaStore,
        get,
        set,
        pushRestoredClip,
        flushRestoredClipBuffer,
        isCurrentTimelineSession,
        wakePreviewAfterRestore,
        restoreSourceThumbnails,
      });
      if (compositionResult === 'stale') {
        return;
      }
      if (compositionResult === 'handled') {
        continue;
      }

      const generatedClip = await createLoadStateGeneratedClip({ serializedClip, mediaStore });
      if (generatedClip) {
        pushRestoredClip(generatedClip);
        continue;
      }

      const mediaResult = await restoreLoadStateMediaClip({
        serializedClip,
        mediaStore,
        set,
        pushRestoredClip,
        patchRestoredClip,
        updateMediaFile: (mediaFileId, patch) => {
          useMediaStore.setState((state) => ({
            files: state.files.map((currentFile) =>
              currentFile.id === mediaFileId ? { ...currentFile, ...patch } : currentFile
            ),
          }));
        },
        restoreSourceThumbnails,
        isCurrentTimelineSession,
        wakePreviewAfterRestore,
      });
      if (mediaResult === 'stale') {
        return;
      }
    }

    flushRestoredClipBuffer();
    get().relinkClipStemSeparationJobsFromMediaLibrary();
    });
  },

  // Clear all timeline data
  clearTimeline: () => {
    const { clips, pause } = get();

    // Stop playback
    pause();

    // CRITICAL: Clear store state FIRST — synchronously.
    // The rAF render loop reads clips/layers from the store. If we destroy
    // media resources while clips still reference them, the render loop can
    // pass a closed VideoFrame to importExternalTexture → GPU crash.
    const { tracks } = get();
    const nextTimelineSessionId = get().timelineSessionId + 1;
    // Clear the runtime meter bus (source of truth) before resetting the store
    // mirror, so a pending bus write cannot repopulate stale meters after load.
    runtimeAudioMeterBus.clearAll();
    set({
      clips: [],
      layers: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      transitionEditPreview: null,
      targetTrackIdByType: {},
      cachedFrameTimes: new Set(),
      ramPreviewProgress: null,
      ramPreviewRange: null,
      isRamPreviewing: false,
      videoBakeRegionSelection: null,
      videoBakeRegions: [],
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(getDefaultExpandedTrackIds(tracks)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      runtimeAudioMeters: { trackMeters: {} },
      clipStemSeparationJobs: {},
      timelineSessionId: nextTimelineSessionId,
    });
    releaseAllLazyTimelineMediaElements();
    releaseAllLazyTimelineImageElements();
    clearAINodeRuntimeCache();
    blobUrlManager.clear();

    releaseLegacyTimelineClipSourceRuntimes(clips, {
      recurseNestedClips: true,
      revokeObjectUrls: true,
    });
    renderHostPort.clearCaches();
    layerBuilder.getVideoSyncManager().reset();
  },
});
