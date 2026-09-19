import { Logger } from '../../../services/logger';
import { cleanupDeletedClipResources } from '../deletedClipResources';
import {
  createCompositionAudioClip,
  findOrCreateAudioTrack,
} from '../helpers/audioTrackHelpers';
import { generateClipId } from '../helpers/idGenerator';
import {
  calculateNestedClipBoundaries,
  loadNestedClips,
  scheduleNestedClipSegmentBuild,
} from '../nestedCompositionLoader';
import { findCompositionInsertionCycle } from '../compositionCycleGuard';
import { captureSnapshot } from '../../historyStore';
import type { Composition } from '../../mediaStore';
import { getTimelineCompositionReplacementContext } from '../../../services/timeline/timelineMediaReplacementAccess';
import type { TimelineClip } from '../../../types/timeline';
import { createNestedContentHash } from './addCompClip';
import type { ClipActionContext } from './clipActionContext';
import { beginNestedCompositionLoad, releaseStaleNestedCompositionClips } from '../nestedCompositionLoadGeneration';

const log = Logger.create('ReplaceClipSourceWithComposition');

function getCompositionDuration(composition: Composition): number {
  const duration = composition.timelineData?.duration ?? composition.duration;
  return Number.isFinite(duration) && duration > 0 ? duration : 5;
}

function collectNestedClipIds(clips: readonly TimelineClip[] | undefined, result = new Set<string>()): Set<string> {
  for (const clip of clips ?? []) {
    result.add(clip.id);
    collectNestedClipIds(clip.nestedClips, result);
  }
  return result;
}

function clearOldNestedKeyframes(
  state: ReturnType<ClipActionContext['get']>,
  nestedClipIds: ReadonlySet<string>,
): Pick<ReturnType<ClipActionContext['get']>, 'clipKeyframes' | 'selectedKeyframeIds' | 'keyframeRecordingEnabled'> {
  if (nestedClipIds.size === 0) {
    return {
      clipKeyframes: state.clipKeyframes,
      selectedKeyframeIds: state.selectedKeyframeIds,
      keyframeRecordingEnabled: state.keyframeRecordingEnabled,
    };
  }

  const clipKeyframes = new Map(state.clipKeyframes);
  const removedKeyframeIds = new Set<string>();
  nestedClipIds.forEach((nestedClipId) => {
    for (const keyframe of clipKeyframes.get(nestedClipId) ?? []) {
      removedKeyframeIds.add(keyframe.id);
    }
    clipKeyframes.delete(nestedClipId);
  });

  return {
    clipKeyframes,
    selectedKeyframeIds: new Set(
      [...state.selectedKeyframeIds].filter(keyframeId => !removedKeyframeIds.has(keyframeId)),
    ),
    keyframeRecordingEnabled: new Set(
      [...state.keyframeRecordingEnabled].filter((entry) => {
        const separatorIndex = entry.indexOf(':');
        const clipId = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
        return !nestedClipIds.has(clipId);
      }),
    ),
  };
}

function createCompositionVideoClip(
  clip: TimelineClip,
  composition: Composition,
  compositionDuration: number,
): TimelineClip {
  return {
    ...clip,
    name: composition.name,
    file: new File([], composition.name),
    source: { type: 'video', naturalDuration: compositionDuration },
    mediaFileId: undefined,
    thumbnails: undefined,
    videoState: undefined,
    analysis: undefined,
    analysisProgress: undefined,
    analysisStatus: undefined,
    faceAnalysisMessage: undefined,
    faceAnalysisProgress: undefined,
    faceAnalysisStatus: undefined,
    sceneDescriptionMessage: undefined,
    sceneDescriptionProgress: undefined,
    sceneDescriptionStatus: undefined,
    sceneDescriptions: undefined,
    transcript: undefined,
    transcriptMessage: undefined,
    transcriptProgress: undefined,
    transcriptStatus: undefined,
    isComposition: true,
    compositionId: composition.id,
    nestedClips: [],
    nestedTracks: composition.timelineData?.tracks ?? [],
    nestedContentHash: createNestedContentHash(composition.timelineData),
    nestedClipBoundaries: composition.timelineData
      ? calculateNestedClipBoundaries(composition.timelineData, compositionDuration)
      : [],
    clipSegments: undefined,
    mixdownAudio: undefined,
    mixdownBuffer: undefined,
    mixdownWaveform: undefined,
    mixdownGenerating: false,
    hasMixdownAudio: false,
    isLoading: Boolean(composition.timelineData),
    needsReload: false,
  };
}

function createCompositionAudioReplacement(
  clip: TimelineClip,
  composition: Composition,
  compositionDuration: number,
  linkedVideoClipId: string,
): TimelineClip {
  const {
    bakeHistory: _bakeHistory,
    processedAnalysisRefs: _processedAnalysisRefs,
    sourceAnalysisRefs: _sourceAnalysisRefs,
    sourceAudioRevisionId: _sourceAudioRevisionId,
    stemSeparation: _stemSeparation,
    ...retainedAudioState
  } = clip.audioState ?? {};

  return {
    ...clip,
    name: `${composition.name} (Audio)`,
    file: new File([], `${composition.name}-audio.wav`),
    source: { type: 'audio', naturalDuration: compositionDuration },
    mediaFileId: undefined,
    linkedClipId: linkedVideoClipId,
    audioState: retainedAudioState,
    audioAnalysisJob: undefined,
    waveform: undefined,
    waveformChannels: undefined,
    waveformGenerating: false,
    waveformProgress: 0,
    isComposition: true,
    compositionId: composition.id,
    mixdownAudio: undefined,
    mixdownBuffer: undefined,
    mixdownWaveform: undefined,
    mixdownGenerating: false,
    hasMixdownAudio: false,
    isLoading: false,
    needsReload: false,
  };
}

function createLinkedCompositionAudioClip(params: {
  clip: TimelineClip;
  composition: Composition;
  compositionDuration: number;
  trackId: string;
}): TimelineClip {
  const { clip, composition, compositionDuration, trackId } = params;
  const audioClip = createCompositionAudioClip({
    clipId: generateClipId('clip-comp-audio'),
    trackId,
    compositionName: composition.name,
    compositionId: composition.id,
    startTime: clip.startTime,
    duration: clip.duration,
    linkedClipId: clip.id,
  });
  return {
    ...audioClip,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: { type: 'audio', naturalDuration: compositionDuration },
  };
}

export async function replaceClipSourceWithCompositionAction(
  context: ClipActionContext,
  clipId: string,
  compositionId: string,
): Promise<boolean> {
  const state = context.get();
  const clip = state.clips.find(candidate => candidate.id === clipId);
  const track = clip ? state.tracks.find(candidate => candidate.id === clip.trackId) : undefined;
  const mediaContext = getTimelineCompositionReplacementContext(compositionId);
  const composition = mediaContext.composition;
  if (!clip || track?.locked || clip.source?.type !== 'video' || !composition) {
    return false;
  }
  if (clip.isComposition && clip.compositionId === compositionId) {
    return true;
  }

  const parentCompositionId = mediaContext.activeCompositionId;
  if (parentCompositionId) {
    const cycle = findCompositionInsertionCycle({
      parentCompositionId,
      childCompositionId: compositionId,
      compositions: mediaContext.compositions,
    });
    if (cycle) {
      log.warn('Cannot replace clip source because it would create a composition cycle', {
        clipId,
        parentCompositionId,
        compositionId,
        compositionPath: cycle,
      });
      return false;
    }
  }

  const linkedAudioClip = clip.linkedClipId
    ? state.clips.find(candidate => candidate.id === clip.linkedClipId && candidate.source?.type === 'audio')
    : undefined;
  cleanupDeletedClipResources(linkedAudioClip ? [clip, linkedAudioClip] : [clip]);

  const compositionDuration = getCompositionDuration(composition);
  let nextTracks = state.tracks;
  let nextAudioClip: TimelineClip;
  if (linkedAudioClip) {
    nextAudioClip = createCompositionAudioReplacement(
      linkedAudioClip,
      composition,
      compositionDuration,
      clip.id,
    );
  } else {
    const audioPlacement = findOrCreateAudioTrack(
      state.tracks,
      state.clips,
      clip.startTime,
      clip.duration,
    );
    if (audioPlacement.newTrack) {
      nextTracks = [...state.tracks, audioPlacement.newTrack];
    }
    nextAudioClip = createLinkedCompositionAudioClip({
      clip,
      composition,
      compositionDuration,
      trackId: audioPlacement.trackId,
    });
  }

  const nextVideoClip = {
    ...createCompositionVideoClip(clip, composition, compositionDuration),
    linkedClipId: nextAudioClip.id,
  };
  const nestedContentHash = createNestedContentHash(composition.timelineData, mediaContext.compositions);
  nextVideoClip.nestedContentHash = nestedContentHash;
  nextAudioClip.nestedContentHash = nestedContentHash;
  const propertyTimelineState = clearOldNestedKeyframes(
    state,
    collectNestedClipIds(clip.nestedClips),
  );
  context.set({
    tracks: nextTracks,
    clips: [
      ...state.clips.map((candidate) => {
        if (candidate.id === clip.id) return nextVideoClip;
        if (linkedAudioClip && candidate.id === linkedAudioClip.id) return nextAudioClip;
        return candidate;
      }),
      ...(linkedAudioClip ? [] : [nextAudioClip]),
    ],
    ...propertyTimelineState,
  });

  const timelineSessionId = state.timelineSessionId;
  const isLatestLoad = beginNestedCompositionLoad(context.get, clip.id);
  const isCurrentTimelineSession = () => context.get().timelineSessionId === timelineSessionId
    && isLatestLoad() && context.get().clips.some(candidate => candidate.id === clip.id && candidate.compositionId === compositionId);
  let nestedClips: TimelineClip[] = [];
  if (composition.timelineData) {
    try {
      nestedClips = await loadNestedClips({
        compClipId: clip.id,
        composition,
        get: context.get,
        set: context.set,
        isCurrentTimelineSession,
      });
    } catch (error) {
      log.warn('Failed to load replacement composition source', {
        clipId,
        compositionId,
        error,
      });
    }
  }

  if (!isCurrentTimelineSession()) {
    releaseStaleNestedCompositionClips(nestedClips);
    return false;
  }
  context.set({
    clips: context.get().clips.map(candidate => (
      candidate.id === clip.id && candidate.compositionId === compositionId
        ? { ...candidate, nestedClips, isLoading: false }
        : candidate
    )),
  });

  if (composition.timelineData && context.get().thumbnailsEnabled) {
    scheduleNestedClipSegmentBuild({
      clipId: clip.id,
      timelineData: composition.timelineData,
      compDuration: compositionDuration,
      nestedClips,
      thumbnailsEnabled: true,
      get: context.get,
      set: context.set,
      isCurrentTimelineSession,
      delayMs: 500,
      logLabel: 'Set clip segments for replaced composition source',
    });
  }

  context.get().invalidateCache();
  captureSnapshot('Replace clip source with composition');
  return true;
}
