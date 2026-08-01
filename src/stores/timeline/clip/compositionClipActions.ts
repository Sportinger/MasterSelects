import { Logger } from '../../../services/logger';
import type { Composition } from '../types';
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
import { releaseCompositionMixdownClipRuntime } from '../../../services/timeline/compositionAudioMixdownRuntimeResources';
import type { ClipActionContext } from './clipActionContext';
import { findCompositionInsertionCycle } from '../compositionCycleGuard';

const log = Logger.create('CompositionClipActions');

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
  const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId;

  const compClip = createCompClipPlaceholder({ trackId, composition, startTime, findNonOverlappingPosition });
  set({ clips: [...clips, compClip] });
  updateDuration();

  if (composition.timelineData) {
    const nestedClips = await loadNestedClips({
      compClipId: compClip.id,
      composition,
      get,
      set,
      isCurrentTimelineSession,
    });
    if (!isCurrentTimelineSession()) return;

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

  await createCompLinkedAudioClip({
    compClipId: compClip.id,
    composition,
    compClipStartTime: compClip.startTime,
    compDuration: composition.timelineData?.duration ?? composition.duration,
    tracks: get().tracks,
    set,
    get,
  });

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

  const compClips = clips.filter(c => c.isComposition && c.compositionId === sourceCompositionId);
  if (compClips.length === 0) {
    log.info('No comp clips found referencing this composition');
    return;
  }

  const { useMediaStore } = await import('../../mediaStore');
  const composition = useMediaStore.getState().compositions.find(c => c.id === sourceCompositionId);
  if (!composition?.timelineData) {
    log.debug('No timelineData for composition', { sourceCompositionId });
    return;
  }

  const newContentHash = createNestedContentHash(composition.timelineData);
  log.info('Refreshing nested clips for composition', {
    compositionId: sourceCompositionId,
    compositionName: composition.name,
    affectedClips: compClips.length,
    newClipCount: composition.timelineData.clips.length,
    newTrackCount: composition.timelineData.tracks.length,
  });

  for (const compClip of compClips) {
    if (!isCurrentTimelineSession()) return;

    const contentHashChanged = compClip.nestedContentHash !== newContentHash;
    const needsThumbnailUpdate = contentHashChanged;
    const nestedClips = await loadNestedClips({
      compClipId: compClip.id,
      composition,
      get,
      set,
      isCurrentTimelineSession,
    });
    if (!isCurrentTimelineSession()) return;

    const nestedTracks = composition.timelineData.tracks;
    const compDuration = composition.timelineData?.duration ?? composition.duration;
    const nestedClipBoundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

    set({
      clips: get().clips.map(c =>
        c.id === compClip.id
          ? {
              ...c,
              nestedClips,
              nestedTracks,
              nestedContentHash: newContentHash,
              nestedClipBoundaries,
              ...(contentHashChanged
                ? {
                    mixdownAudio: undefined,
                    mixdownBuffer: undefined,
                    mixdownWaveform: undefined,
                    hasMixdownAudio: false,
                    mixdownGenerating: false,
                  }
                : {}),
              clipSegments: needsThumbnailUpdate ? undefined : c.clipSegments,
            }
          : c
      ),
    });
    if (contentHashChanged) {
      releaseCompositionMixdownClipRuntime(compClip);
      blobUrlManager.revokeType(compClip.id, 'audio');
    }

    if (needsThumbnailUpdate && get().thumbnailsEnabled) {
      scheduleNestedClipSegmentBuild({
        clipId: compClip.id,
        timelineData: composition.timelineData,
        compDuration,
        nestedClips,
        thumbnailsEnabled: true,
        get,
        set,
        isCurrentTimelineSession,
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
