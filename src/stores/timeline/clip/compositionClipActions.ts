import { Logger } from '../../../services/logger';
import type { Composition, TimelineClip } from '../types';
import { blobUrlManager } from '../helpers/blobUrlManager';
import {
  calculateNestedClipBoundaries,
  loadNestedClips,
  scheduleNestedClipSegmentBuild,
} from '../nestedCompositionLoader';
import {
  createCompClipPlaceholder,
  createCompLinkedAudioClip,
  createNestedContentHash,
} from './addCompClip';
import { detachCompositionMixdownAudioElement, releaseCompositionMixdownClipRuntime } from '../../../services/timeline/compositionAudioMixdownRuntimeResources';
import { beginNestedCompositionLoad, releaseStaleNestedCompositionClips } from '../nestedCompositionLoadGeneration';
import { getCompositionContentDependents } from './nestedCompositionContentHash';
import type { ClipActionContext } from './clipActionContext';
import { findCompositionInsertionCycle } from '../compositionCycleGuard';

const log = Logger.create('CompositionClipActions');

function resetCompositionMixdown(clip: TimelineClip): Partial<TimelineClip> {
  detachCompositionMixdownAudioElement(clip);
  releaseCompositionMixdownClipRuntime(clip);
  blobUrlManager.revokeType(clip.id, 'audio');
  return {
    mixdownAudio: undefined,
    mixdownBuffer: undefined,
    mixdownWaveform: undefined,
    hasMixdownAudio: false,
    mixdownGenerating: false,
    ...(clip.audioState ? {
      audioState: { ...clip.audioState, sourceAnalysisRefs: undefined, processedAnalysisRefs: undefined },
    } : {}),
  };
}

export async function applyAddCompClipAction(
  context: ClipActionContext,
  trackId: string,
  composition: Composition,
  startTime: number,
): Promise<void> {
  const { get, set } = context;
  const { clips, tracks, updateDuration, findNonOverlappingPosition, thumbnailsEnabled, invalidateCache } = get();
  if (tracks.find(track => track.id === trackId)?.locked) {
    log.warn('Cannot add composition clip to locked track', { trackId, composition: composition.name });
    return;
  }
  const { useMediaStore } = await import('../../mediaStore');
  const mediaState = useMediaStore.getState();
  const parentCompositionId = mediaState.activeCompositionId;
  if (parentCompositionId) {
    const cycle = findCompositionInsertionCycle({
      parentCompositionId,
      childCompositionId: composition.id,
      compositions: mediaState.compositions,
    });
    if (cycle) {
      log.warn('Cannot add composition clip because it would create a cycle', {
        parentCompositionId,
        childCompositionId: composition.id,
        compositionPath: cycle,
      });
      return;
    }
  }
  const timelineSessionId = get().timelineSessionId;

  const compClip = createCompClipPlaceholder({
    trackId, composition, compositions: mediaState.compositions, startTime, findNonOverlappingPosition,
  });
  set({ clips: [...clips, compClip] });
  updateDuration();
  const isLatestLoad = beginNestedCompositionLoad(get, compClip.id);
  const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId
    && isLatestLoad() && get().clips.some(clip => clip.id === compClip.id && clip.compositionId === composition.id);

  // Install both wrappers before visual loading can yield to another refresh.
  await createCompLinkedAudioClip({
    compClipId: compClip.id,
    composition,
    compositions: mediaState.compositions,
    compClipStartTime: compClip.startTime,
    compDuration: composition.timelineData?.duration ?? composition.duration,
    tracks: get().tracks,
    set,
    get,
  });
  if (!isCurrentTimelineSession()) return;

  if (composition.timelineData) {
    const nestedClips = await loadNestedClips({
      compClipId: compClip.id,
      composition,
      get,
      set,
      isCurrentTimelineSession,
    });
    if (!isCurrentTimelineSession()) {
      releaseStaleNestedCompositionClips(nestedClips);
      return;
    }

    const nestedTracks = composition.timelineData.tracks;
    const compDuration = composition.timelineData?.duration ?? composition.duration;
    const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

    set({
      clips: get().clips.map(c =>
        c.id === compClip.id ? { ...c, nestedClips, nestedTracks, nestedClipBoundaries: boundaries, isLoading: false } : c
      ),
    });

    scheduleNestedClipSegmentBuild({
      clipId: compClip.id,
      timelineData: composition.timelineData,
      compDuration,
      nestedClips,
      thumbnailsEnabled,
      get,
      set,
      isCurrentTimelineSession,
      delayMs: 500,
      logLabel: 'Set clip segments for nested comp',
    });
  }

  invalidateCache();
}

export async function refreshCompClipNestedDataAction(
  context: ClipActionContext,
  sourceCompositionId: string,
): Promise<void> {
  const { get, set } = context;
  const { clips, invalidateCache } = get();
  const timelineSessionId = get().timelineSessionId;
  const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId;

  log.info('refreshCompClipNestedData called', {
    sourceCompositionId,
    totalClips: clips.length,
    compClips: clips.filter(c => c.isComposition).map(c => ({
      id: c.id,
      name: c.name,
      compositionId: c.compositionId,
    })),
  });

  const { useMediaStore } = await import('../../mediaStore');
  if (!isCurrentTimelineSession()) return;
  const compositions = useMediaStore.getState().compositions;
  const affectedCompositionIds = getCompositionContentDependents(sourceCompositionId, compositions);
  const compClips = get().clips.filter(c =>
    c.isComposition && c.compositionId && affectedCompositionIds.has(c.compositionId)
  );
  if (compClips.length === 0) {
    log.info('No comp clips found referencing this composition');
    return;
  }

  // Reserve every affected instance before awaiting the first video load. This
  // also prevents an older request from later clearing its linked audio clip.
  const refreshes = compClips.map(compClip => ({ compClip, isLatestLoad: beginNestedCompositionLoad(get, compClip.id) }));

  for (const { compClip, isLatestLoad } of refreshes) {
    if (!isCurrentTimelineSession()) return;
    const composition = compositions.find(c => c.id === compClip.compositionId);
    if (!composition?.timelineData) continue;
    const newContentHash = createNestedContentHash(composition.timelineData, compositions);
    const compDuration = composition.timelineData.duration ?? composition.duration;
    const isCurrentRefresh = () => {
      if (!isCurrentTimelineSession() || !isLatestLoad()) return false;
      const currentClip = get().clips.find(clip => clip.id === compClip.id);
      if (!currentClip?.isComposition || currentClip.compositionId !== composition.id) return false;
      const currentCompositions = useMediaStore.getState().compositions;
      const currentSource = currentCompositions.find(candidate => candidate.id === composition.id);
      return !!currentSource && createNestedContentHash(currentSource.timelineData, currentCompositions) === newContentHash;
    };
    if (!isCurrentRefresh()) continue;
    if (compClip.source?.type === 'audio') {
      set({ clips: get().clips.map(c => {
        if (c.id !== compClip.id) return c;
        const contentHashChanged = c.nestedContentHash !== newContentHash;
        return {
          ...c, nestedContentHash: newContentHash,
          ...(contentHashChanged ? {
            ...resetCompositionMixdown(c),
            source: { ...c.source!, audioElement: undefined, naturalDuration: compDuration },
            waveform: undefined, waveformChannels: undefined,
          } : {}),
        };
      }) });
      continue;
    }
    const nestedClips = await loadNestedClips({
      compClipId: compClip.id,
      composition,
      get,
      set,
      isCurrentTimelineSession: isCurrentRefresh,
    });
    if (!isCurrentRefresh()) {
      releaseStaleNestedCompositionClips(nestedClips);
      continue;
    }

    const nestedTracks = composition.timelineData.tracks;
    const nestedClipBoundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);
    const needsThumbnailUpdate = get().clips.find(clip => clip.id === compClip.id)?.nestedContentHash !== newContentHash;

    set({
      clips: get().clips.map(c =>
        c.id === compClip.id
          ? {
              ...c,
              nestedClips,
              nestedTracks,
              nestedContentHash: newContentHash,
              nestedClipBoundaries,
              isLoading: false,
              needsReload: false,
              ...(needsThumbnailUpdate ? resetCompositionMixdown(c) : {}),
              clipSegments: needsThumbnailUpdate ? undefined : c.clipSegments,
            }
          : c
      ),
    });
    if (needsThumbnailUpdate && get().thumbnailsEnabled) {
      scheduleNestedClipSegmentBuild({
        clipId: compClip.id,
        timelineData: composition.timelineData,
        compDuration,
        nestedClips,
        thumbnailsEnabled: true,
        get,
        set,
        isCurrentTimelineSession: isCurrentRefresh,
        delayMs: 500,
        logLabel: 'Updated clip segments for nested comp',
      });
    } else {
      log.debug('Skipped segment regeneration (no content change or thumbnails disabled)', {
        compClipId: compClip.id,
      });
    }
  }

  if (!isCurrentTimelineSession()) return;
  invalidateCache();
}
