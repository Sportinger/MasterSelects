// Clip-related actions slice - Coordinator
// Delegates to specialized modules in ./clip/ and ./helpers/
// Reduced from ~2031 LOC to ~650 LOC (68% reduction)

import type { TimelineClip, TimelineTrack } from '../../types';
import type {
  AudioAnalysisArtifactKind,
  ClipAudioAnalysisJobKind,
  ClipAudioAnalysisJobPhase,
} from '../../types/audio';
import type { AddClipOptions, CoreClipActions, GenerateClipAudioAnalysisOptions, SliceCreator, Composition } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateWaveformFromBuffer } from './helpers/waveformHelpers';
import { Logger } from '../../services/logger';
import { cloneClipNodeGraph } from '../../services/nodeGraph';
import {
  createCurrentAudioArtifactStore,
  generateTimelineWaveformAnalysisForFile,
} from '../../services/audio/timelineWaveformPyramidCache';
import { audioExtractor } from '../../engine/audio/AudioExtractor';
import {
  ProcessedWaveformPyramidService,
  clipRequiresProcessedWaveformPyramid,
  createFileAudioSourceFingerprint,
  createProcessedClipAudioStateHash,
} from '../../services/audio/ProcessedWaveformPyramidService';
import { SpectrogramTileSetGenerator } from '../../services/audio/SpectrogramTileSetGenerator';
import {
  primeTimelineSpectrogramTileSetCache,
  readTimelineSpectrogramTileSet,
} from '../../services/audio/timelineSpectrogramCache';
import { LoudnessEnvelopeGenerator } from '../../services/audio/LoudnessEnvelopeGenerator';
import {
  primeTimelineLoudnessEnvelopeCache,
  readTimelineLoudnessEnvelope,
} from '../../services/audio/timelineLoudnessEnvelopeCache';
import { BeatOnsetAnalysisGenerator } from '../../services/audio/BeatOnsetAnalysisGenerator';
import {
  primeTimelineBeatGridCache,
  primeTimelineOnsetMapCache,
  readTimelineBeatGrid,
  readTimelineOnsetMap,
} from '../../services/audio/timelineBeatOnsetCache';
import { FrequencyPhaseAnalysisGenerator } from '../../services/audio/FrequencyPhaseAnalysisGenerator';
import {
  primeTimelineFrequencySummaryCache,
  primeTimelinePhaseCorrelationCache,
  readTimelineFrequencySummary,
  readTimelinePhaseCorrelation,
} from '../../services/audio/timelineFrequencyPhaseCache';
import {
  isPreparedClipAudioAnalysisInputStale,
  prepareClipAudioAnalysisInput,
} from '../../services/audio/ClipAudioAnalysisOrchestrator';
import {
  createClipAudioAnalysisJobState,
  updateClipAudioAnalysisJobState,
} from '../../services/audio/clipAudioAnalysisJobs';
import {
  clipAudioAnalysisJobService,
  isClipAudioAnalysisJobCancelledError,
} from '../../services/audio/ClipAudioAnalysisJobService';

const log = Logger.create('ClipSlice');

function createAudioAnalysisJobUpdate(input: {
  kind: ClipAudioAnalysisJobKind;
  label: string;
  artifactKinds: AudioAnalysisArtifactKind[];
  processed: boolean;
}): Pick<TimelineClip, 'audioAnalysisJob' | 'waveformGenerating' | 'waveformProgress'> {
  return {
    waveformGenerating: true,
    waveformProgress: 0,
    audioAnalysisJob: createClipAudioAnalysisJobState(input),
  };
}

function updateAudioAnalysisJobProgress(
  clips: TimelineClip[],
  clipId: string,
  progress: number,
  phase: ClipAudioAnalysisJobPhase,
  message?: string,
): TimelineClip[] {
  const clip = clips.find(c => c.id === clipId);
  if (!clip?.audioAnalysisJob) {
    return updateClipById(clips, clipId, { waveformProgress: progress });
  }

  return updateClipById(clips, clipId, {
    waveformProgress: progress,
    audioAnalysisJob: updateClipAudioAnalysisJobState(clip.audioAnalysisJob, {
      progress,
      phase,
      message,
    }),
  });
}

function clearAudioAnalysisJobUpdate(): Pick<
  TimelineClip,
  'audioAnalysisJob' | 'waveformGenerating'
> {
  return {
    audioAnalysisJob: undefined,
    waveformGenerating: false,
  };
}

function isAudioAnalysisCancellation(error: unknown): boolean {
  if (isClipAudioAnalysisJobCancelledError(error)) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { name?: unknown; code?: unknown };
  return maybe.name === 'AbortError'
    || maybe.code === 'cancelled'
    || (typeof maybe.name === 'string' && maybe.name.includes('Cancelled'));
}

async function resolveClipSourceFile(clip: TimelineClip): Promise<File | undefined> {
  if (clip.file instanceof File) {
    return clip.file;
  }

  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) return undefined;

  try {
    const { useMediaStore } = await import('../mediaStore');
    const mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFileId);
    return mediaFile?.file;
  } catch {
    return undefined;
  }
}

function isPlaneClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'video' || clip.source?.type === 'image';
}

function isTrackLocked(tracks: TimelineTrack[], trackId: string | undefined): boolean {
  return !!trackId && tracks.find(t => t.id === trackId)?.locked === true;
}

function isClipOnLockedTrack(clips: TimelineClip[], tracks: TimelineTrack[], clipId: string): boolean {
  const clip = clips.find(c => c.id === clipId);
  return isTrackLocked(tracks, clip?.trackId);
}

function applyAddClipOptions(clip: TimelineClip, options?: AddClipOptions): TimelineClip {
  if (!options) return clip;

  return {
    ...clip,
    ...(options.name ? { name: options.name } : {}),
    ...(options.signalAssetId ? { signalAssetId: options.signalAssetId } : {}),
    ...(options.signalRefId ? { signalRefId: options.signalRefId } : {}),
    ...(options.signalRenderAdapterId ? { signalRenderAdapterId: options.signalRenderAdapterId } : {}),
    source: clip.source && options.source
      ? { ...clip.source, ...options.source }
      : clip.source,
  };
}

/** Deep clone properties that must not be shared between split clips */
function deepCloneClipProps(clip: TimelineClip): Partial<TimelineClip> {
  return {
    transform: structuredClone(clip.transform),
    effects: clip.effects.map(e => structuredClone(e)),
    ...(clip.colorCorrection ? { colorCorrection: structuredClone(clip.colorCorrection) } : {}),
    ...(clip.nodeGraph ? { nodeGraph: cloneClipNodeGraph(clip.nodeGraph) } : {}),
    ...(clip.masks ? { masks: clip.masks.map(m => structuredClone(m)) } : {}),
    ...(clip.textProperties ? { textProperties: structuredClone(clip.textProperties) } : {}),
    ...(clip.transitionIn ? { transitionIn: structuredClone(clip.transitionIn) } : {}),
    ...(clip.transitionOut ? { transitionOut: structuredClone(clip.transitionOut) } : {}),
    ...(clip.analysis ? { analysis: structuredClone(clip.analysis) } : {}),
  };
}

// Import extracted modules
import { classifyMediaType } from './helpers/mediaTypeHelpers';
import { loadVideoMedia } from './clip/addVideoClip';
import { createAudioClipPlaceholder, loadAudioMedia } from './clip/addAudioClip';
import { createImageClipPlaceholder, loadImageMedia } from './clip/addImageClip';
import { createLottieClipPlaceholder, loadLottieMedia } from './clip/addLottieClip';
import { createRiveClipPlaceholder, loadRiveMedia } from './clip/addRiveClip';
import { createModelClipPlaceholder, loadModelMedia } from './clip/addModelClip';
import { createGaussianSplatClipPlaceholder, loadGaussianSplatMedia } from './clip/addGaussianSplatClip';
import { createVideoElement, createAudioElement } from './helpers/webCodecsHelpers';
import {
  createCompClipPlaceholder,
  loadNestedClips,
  createCompLinkedAudioClip,
  createNestedContentHash,
  calculateNestedClipBoundaries,
  buildClipSegments,
} from './clip/addCompClip';
import {
  generateLinkedClipIds,
} from './helpers/idGenerator';
import { blobUrlManager } from './helpers/blobUrlManager';
import { updateClipById } from './helpers/clipStateHelpers';
import {
  applyClipUpdatesWithAudioAnalysisInvalidation,
  clearProcessedAudioAnalysisRefs,
} from './helpers/audioAnalysisStateHelpers';
import { readLottieMetadata } from '../../services/vectorAnimation/lottieMetadata';
import { readRiveMetadata } from '../../services/vectorAnimation/riveMetadata';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';

export const createClipSlice: SliceCreator<CoreClipActions> = (set, get) => ({
  addClip: async (trackId, file, startTime, providedDuration, mediaFileId, mediaTypeOverride?, options?) => {
    const mediaType = (mediaTypeOverride as Awaited<ReturnType<typeof classifyMediaType>> | 'gaussian-avatar' | 'gaussian-splat') || await classifyMediaType(file);
    const estimatedDuration = providedDuration ?? 5;

    log.debug('Adding clip', { mediaType, file: file.name });

    // Validate track exists and matches media type
    const { tracks, clips, updateDuration, thumbnailsEnabled, waveformsEnabled, invalidateCache } = get();
    const targetTrack = tracks.find(t => t.id === trackId);
    if (!targetTrack) {
      log.warn('Track not found', { trackId });
      return undefined;
    }
    if (targetTrack.locked) {
      log.warn('Cannot add clip to locked track', { trackId });
      return undefined;
    }

    if (mediaType === 'unknown') {
      log.warn('Unsupported clip type', { file: file.name });
      return undefined;
    }

    if ((mediaType === 'video' || mediaType === 'image' || mediaType === 'lottie' || mediaType === 'rive' || mediaType === 'model' || mediaType === 'gaussian-avatar' || mediaType === 'gaussian-splat') && targetTrack.type !== 'video') {
      log.warn('Cannot add visual clip to audio track');
      return undefined;
    }
    if (mediaType === 'audio' && targetTrack.type !== 'audio') {
      log.warn('Cannot add audio to video track');
      return undefined;
    }

    // Helper to update clip when loaded
    const updateClip = (id: string, updates: Partial<TimelineClip>) => {
      set({ clips: get().clips.map(c => c.id === id ? { ...c, ...updates } : c) });
      get().updateDuration();
    };
    const setClips = (updater: (clips: TimelineClip[]) => TimelineClip[]) => {
      set({ clips: updater(get().clips) });
    };

    // Look up transcript from MediaFile for carry-over to new clips
    let sourceTranscript: import('../../types').TranscriptWord[] | undefined;
    let sourceMediaFile:
      | {
        transcript?: import('../../types').TranscriptWord[];
        transcriptStatus?: string;
        modelSequence?: import('../../types').ModelSequenceData;
        gaussianSplatSequence?: import('../../types').GaussianSplatSequenceData;
        vectorAnimation?: import('../../types').VectorAnimationMetadata;
        url?: string;
        name?: string;
        projectPath?: string;
        absolutePath?: string;
        filePath?: string;
      }
      | undefined;
    if (mediaFileId) {
      try {
        const { useMediaStore } = await import('../mediaStore');
        sourceMediaFile = useMediaStore.getState().files.find((f: { id: string }) => f.id === mediaFileId);
        if (sourceMediaFile?.transcriptStatus === 'ready' && sourceMediaFile.transcript?.length) {
          sourceTranscript = sourceMediaFile.transcript;
        }
      } catch { /* mediaStore not ready */ }
    }

    // Handle video files
    if (mediaType === 'video') {
      // Use function form of set() to ensure we get fresh state
      // This prevents race conditions when multiple files are dropped at once
      const { videoId: clipId, audioId } = generateLinkedClipIds();
      let finalAudioClipId: string | undefined;

      set(state => {
        const endTime = startTime + estimatedDuration;

        // Find an audio track without overlap
        const audioTracks = state.tracks.filter(t => t.type === 'audio' && !t.locked);
        let audioTrackId: string | null = null;

        for (const track of audioTracks) {
          const trackClips = state.clips.filter(c => c.trackId === track.id);
          const hasOverlap = trackClips.some(clip => {
            const clipEnd = clip.startTime + clip.duration;
            return !(endTime <= clip.startTime || startTime >= clipEnd);
          });
          if (!hasOverlap) {
            audioTrackId = track.id;
            break;
          }
        }

        // Create new track if needed
        let newTracks = state.tracks;
        if (!audioTrackId) {
          const newTrackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 5)}-audio`;
          const newTrack: TimelineTrack = {
            id: newTrackId,
            name: `Audio ${audioTracks.length + 1}`,
            type: 'audio',
            height: 60,
            muted: false,
            visible: true,
            solo: false,
          };
          newTracks = [...state.tracks, newTrack];
          audioTrackId = newTrackId;
        }

        // Create video clip
        const videoClip: TimelineClip = {
          id: clipId,
          trackId,
          name: file.name,
          file,
          startTime,
          duration: estimatedDuration,
          inPoint: 0,
          outPoint: estimatedDuration,
          source: { type: 'video', naturalDuration: estimatedDuration, mediaFileId },
          linkedClipId: audioId,
          transform: { ...DEFAULT_TRANSFORM },
          effects: [],
          isLoading: true,
          ...(sourceTranscript ? { transcript: sourceTranscript, transcriptStatus: 'ready' as const } : {}),
        };

        // Create audio clip
        const audioClip: TimelineClip = {
          id: audioId,
          trackId: audioTrackId,
          name: `${file.name} (Audio)`,
          file,
          startTime,
          duration: estimatedDuration,
          inPoint: 0,
          outPoint: estimatedDuration,
          source: { type: 'audio', naturalDuration: estimatedDuration, mediaFileId },
          linkedClipId: clipId,
          transform: { ...DEFAULT_TRANSFORM },
          effects: [],
          isLoading: true,
        };

        finalAudioClipId = audioId;

        return {
          clips: [...state.clips, applyAddClipOptions(videoClip, options), audioClip],
          tracks: newTracks,
        };
      });
      updateDuration();

      await loadVideoMedia({
        clipId,
        audioClipId: finalAudioClipId,
        file,
        mediaFileId,
        thumbnailsEnabled,
        waveformsEnabled,
        updateClip,
        setClips,
      });

      invalidateCache();
      return clipId;
    }

    // Handle audio files
    if (mediaType === 'audio') {
      const audioClip = applyAddClipOptions(
        createAudioClipPlaceholder({ trackId, file, startTime, estimatedDuration, mediaFileId }),
        options,
      );
      // Carry over transcript from MediaFile if available
      if (sourceTranscript) {
        audioClip.transcript = sourceTranscript;
        audioClip.transcriptStatus = 'ready';
      }
      set({ clips: [...clips, audioClip] });
      updateDuration();

      await loadAudioMedia({
        clip: audioClip,
        file,
        mediaFileId,
        waveformsEnabled,
        updateClip,
      });

      invalidateCache();
      return audioClip.id;
    }

    if (mediaType === 'lottie') {
      const vectorAnimationMetadata = sourceMediaFile?.vectorAnimation ?? await readLottieMetadata(file);
      const lottieClip = applyAddClipOptions(
        createLottieClipPlaceholder({
          trackId,
          file,
          startTime,
          estimatedDuration: providedDuration ?? vectorAnimationMetadata.duration ?? estimatedDuration,
          mediaFileId,
          metadata: vectorAnimationMetadata,
        }),
        options,
      );
      set({ clips: [...clips, lottieClip] });
      updateDuration();

      await loadLottieMedia({
        clip: lottieClip,
        file,
        mediaFileId,
        metadata: vectorAnimationMetadata,
        updateClip,
      });

      invalidateCache();
      return lottieClip.id;
    }

    if (mediaType === 'rive') {
      const vectorAnimationMetadata = sourceMediaFile?.vectorAnimation ?? await readRiveMetadata(file);
      const riveClip = applyAddClipOptions(
        createRiveClipPlaceholder({
          trackId,
          file,
          startTime,
          estimatedDuration: providedDuration ?? vectorAnimationMetadata.duration ?? estimatedDuration,
          mediaFileId,
          metadata: vectorAnimationMetadata,
        }),
        options,
      );
      set({ clips: [...clips, riveClip] });
      updateDuration();

      await loadRiveMedia({
        clip: riveClip,
        file,
        mediaFileId,
        metadata: vectorAnimationMetadata,
        updateClip,
      });

      invalidateCache();
      return riveClip.id;
    }

    // Handle image files
    if (mediaType === 'image') {
      const imageClip = applyAddClipOptions(
        createImageClipPlaceholder({ trackId, file, startTime, estimatedDuration }),
        options,
      );
      set({ clips: [...clips, imageClip] });
      updateDuration();

      await loadImageMedia({ clip: imageClip, updateClip });
      invalidateCache();
      return imageClip.id;
    }

    // Handle 3D model files
    if (mediaType === 'model') {
      const modelSequenceDuration = sourceMediaFile?.modelSequence
        ? (providedDuration ?? sourceMediaFile.modelSequence.frameCount / Math.max(1, sourceMediaFile.modelSequence.fps || 30))
        : undefined;
      const modelClip = applyAddClipOptions(
        createModelClipPlaceholder({
          trackId,
          file,
          startTime,
          estimatedDuration: modelSequenceDuration ?? providedDuration ?? 10,
          mediaFileId,
          modelSequence: sourceMediaFile?.modelSequence,
          modelUrl: sourceMediaFile?.url,
          modelFileName: sourceMediaFile?.name ?? file.name,
        }),
        options,
      );
      modelClip.mediaFileId = mediaFileId;  // Link to MediaFile for nested comp lookup
      set({ clips: [...clips, modelClip] });
      updateDuration();
      loadModelMedia({ clip: modelClip, updateClip });
      invalidateCache();
      return modelClip.id;
    }

    // Legacy gaussian-avatar clips are intentionally disabled.
    if (mediaType === 'gaussian-avatar') {
      log.warn('Legacy gaussian-avatar clips are disabled. Import a gaussian-splat scene file instead.', {
        file: file.name,
        mediaFileId,
      });
      return undefined;
    }

    // Handle Gaussian Splat files
    if (mediaType === 'gaussian-splat') {
      const gaussianSplatSequenceDuration = sourceMediaFile?.gaussianSplatSequence
        ? (providedDuration ?? sourceMediaFile.gaussianSplatSequence.frameCount / Math.max(1, sourceMediaFile.gaussianSplatSequence.fps || 30))
        : undefined;
      const splatClip = applyAddClipOptions(
        createGaussianSplatClipPlaceholder({
          trackId,
          file,
          startTime,
          estimatedDuration: gaussianSplatSequenceDuration ?? providedDuration ?? 30,
          mediaFileId,
          gaussianSplatSequence: sourceMediaFile?.gaussianSplatSequence,
          gaussianSplatUrl: sourceMediaFile?.url,
          gaussianSplatFileName: sourceMediaFile?.name ?? file.name,
          gaussianSplatRuntimeKey:
            sourceMediaFile?.projectPath ??
            sourceMediaFile?.absolutePath ??
            sourceMediaFile?.filePath ??
            sourceMediaFile?.url,
        }),
        options,
      );
      splatClip.mediaFileId = mediaFileId;  // Link to MediaFile for nested comp lookup
      set({ clips: [...clips, splatClip] });
      updateDuration();
      loadGaussianSplatMedia({ clip: splatClip, updateClip });
      invalidateCache();
      return splatClip.id;
    }

    return undefined;
  },

  // Add a composition as a clip (nested composition)
  addCompClip: async (trackId, composition: Composition, startTime) => {
    const { clips, tracks, updateDuration, findNonOverlappingPosition, thumbnailsEnabled, invalidateCache } = get();
    if (isTrackLocked(tracks, trackId)) {
      log.warn('Cannot add composition clip to locked track', { trackId, composition: composition.name });
      return;
    }
    const timelineSessionId = get().timelineSessionId;
    const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId;

    const compClip = createCompClipPlaceholder({ trackId, composition, startTime, findNonOverlappingPosition });
    set({ clips: [...clips, compClip] });
    updateDuration();

    // Load nested clips if timeline data exists
    if (composition.timelineData) {
      const nestedClips = await loadNestedClips({ compClipId: compClip.id, composition, get, set });
      if (!isCurrentTimelineSession()) {
        return;
      }
      const nestedTracks = composition.timelineData.tracks;
      const compDuration = composition.timelineData?.duration ?? composition.duration;

      // Calculate clip boundaries for visual markers
      const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

      set({
        clips: get().clips.map(c =>
          c.id === compClip.id ? { ...c, nestedClips, nestedTracks, nestedClipBoundaries: boundaries, isLoading: false } : c
        ),
      });

      // Build segment-based thumbnails (waits for nested clips to load)
      if (thumbnailsEnabled) {
        // Wait a bit for nested clip sources to load, then build segments
        setTimeout(async () => {
          if (!isCurrentTimelineSession()) {
            return;
          }
          // Get fresh nested clips (they may have updated sources now)
          const freshCompClip = get().clips.find(c => c.id === compClip.id);
          if (!freshCompClip) {
            return;
          }
          const freshNestedClips = freshCompClip?.nestedClips || nestedClips;

          const clipSegments = await buildClipSegments(
            composition.timelineData,
            compDuration,
            freshNestedClips
          );

          if (!isCurrentTimelineSession()) {
            return;
          }
          if (clipSegments.length > 0) {
            set({
              clips: get().clips.map(c =>
                c.id === compClip.id ? { ...c, clipSegments } : c
              ),
            });
            log.info('Set clip segments for nested comp', { clipId: compClip.id, segmentCount: clipSegments.length });
          }
        }, 500); // Wait for video elements to load
      }
    }

    // Create linked audio clip (always, even if no audio)
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
  },

  removeClip: (id) => {
    const { clips, tracks, selectedClipIds, updateDuration, invalidateCache } = get();
    const clipToRemove = clips.find(c => c.id === id);
    if (!clipToRemove) return;

    // Determine whether to also remove the linked clip:
    // Only remove linked clip if it is also currently selected
    const linkedId = clipToRemove.linkedClipId;
    const removeLinked = !!(linkedId && selectedClipIds.has(linkedId));
    const idsToRemove = new Set([id]);
    if (removeLinked && linkedId) idsToRemove.add(linkedId);
    if ([...idsToRemove].some(removeId => isClipOnLockedTrack(clips, tracks, removeId))) {
      log.warn('Cannot remove clip from locked track', { id });
      return;
    }

    // Clean up resources for all clips being removed
    for (const removeId of idsToRemove) {
      const clip = clips.find(c => c.id === removeId);
      if (!clip) continue;
      if (clip.source?.type === 'video' && clip.source.videoElement) {
        const video = clip.source.videoElement;
        video.pause();
        video.src = '';
        video.load();
        import('../../engine/WebGPUEngine').then(({ engine }) => engine.cleanupVideo(video));
      }
      if (clip.source?.type === 'audio' && clip.source.audioElement) {
        const audio = clip.source.audioElement;
        audio.pause();
        audio.src = '';
        audio.load();
      }
      if (isVectorAnimationSourceType(clip.source?.type)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
      }
      blobUrlManager.revokeAll(removeId);
    }

    const newSelectedIds = new Set(selectedClipIds);
    for (const removeId of idsToRemove) newSelectedIds.delete(removeId);

    // Build updated clips: remove the clip(s) and clear linkedClipId on the survivor
    const updatedClips = clips
      .filter(c => !idsToRemove.has(c.id))
      .map(c => {
        // If a surviving clip was linked to a removed clip, clear the link
        if (c.linkedClipId && idsToRemove.has(c.linkedClipId)) {
          return { ...c, linkedClipId: undefined };
        }
        return c;
      });

    set({
      clips: updatedClips,
      selectedClipIds: newSelectedIds,
    });
    updateDuration();
    invalidateCache();
  },

  moveClip: (id, newStartTime, newTrackId, skipLinked = false, skipGroup = false, skipTrim = false, excludeClipIds?: string[]) => {
    const { clips, tracks, updateDuration, getSnappedPosition, getPositionWithResistance, trimOverlappingClips, invalidateCache } = get();
    const movingClip = clips.find(c => c.id === id);
    if (!movingClip) return;

    const targetTrackId = newTrackId ?? movingClip.trackId;
    if (isTrackLocked(tracks, movingClip.trackId) || isTrackLocked(tracks, targetTrackId)) {
      log.warn('Cannot move clip on or into locked track', { id, targetTrackId });
      return;
    }
    const linkedClip = clips.find(c => c.id === movingClip.linkedClipId || c.linkedClipId === id);
    if (linkedClip && !skipLinked && isTrackLocked(tracks, linkedClip.trackId)) {
      log.warn('Cannot move linked clip on locked track', { id, linkedClipId: linkedClip.id });
      return;
    }
    const groupClips = !skipGroup && movingClip.linkedGroupId
      ? clips.filter(c => c.linkedGroupId === movingClip.linkedGroupId && c.id !== id)
      : [];
    if (groupClips.some(groupClip => isTrackLocked(tracks, groupClip.trackId))) {
      log.warn('Cannot move linked group with clips on locked tracks', { id });
      return;
    }

    // Validate track type if changing tracks
    if (newTrackId && newTrackId !== movingClip.trackId) {
      const targetTrack = tracks.find(t => t.id === newTrackId);
      const sourceType = movingClip.source?.type;
      if (targetTrack && sourceType) {
        if ((sourceType === 'video' || sourceType === 'image' || sourceType === 'lottie' || sourceType === 'rive' || sourceType === 'camera' || sourceType === 'math-scene') && targetTrack.type !== 'video') return;
        if (sourceType === 'audio' && targetTrack.type !== 'audio') return;
      }
    }

    const { startTime: snappedTime } = getSnappedPosition(id, newStartTime, targetTrackId);
    const resistanceResult = getPositionWithResistance(id, snappedTime, targetTrackId, movingClip.duration, undefined, excludeClipIds);
    let finalStartTime = resistanceResult.startTime;
    let forcingOverlap = resistanceResult.forcingOverlap;
    const { noFreeSpace } = resistanceResult;

    // If no free space on target track (cross-track move), find alternative track or create new one
    let actualTrackId = targetTrackId;
    if (noFreeSpace && targetTrackId !== movingClip.trackId) {
      const targetTrack = tracks.find(t => t.id === targetTrackId);
      if (targetTrack) {
        const altTracks = tracks.filter(t =>
          t.type === targetTrack.type && t.id !== targetTrackId && t.id !== movingClip.trackId && !t.locked
        );
        let found = false;
        for (const alt of altTracks) {
          const altResult = getPositionWithResistance(id, snappedTime, alt.id, movingClip.duration, undefined, excludeClipIds);
          if (!altResult.noFreeSpace) {
            actualTrackId = alt.id;
            finalStartTime = altResult.startTime;
            forcingOverlap = altResult.forcingOverlap;
            found = true;
            break;
          }
        }
        if (!found) {
          // No existing track has space — create a new one
          actualTrackId = get().addTrack(targetTrack.type);
          finalStartTime = Math.max(0, snappedTime);
          forcingOverlap = false;
        }
      }
    }

    const timeDelta = finalStartTime - movingClip.startTime;

    let linkedFinalTime = linkedClip ? linkedClip.startTime + timeDelta : 0;
    let linkedForcingOverlap = false;
    if (linkedClip && !skipLinked) {
      const linkedResult = getPositionWithResistance(linkedClip.id, linkedClip.startTime + timeDelta, linkedClip.trackId, linkedClip.duration, undefined, excludeClipIds);
      linkedFinalTime = linkedResult.startTime;
      linkedForcingOverlap = linkedResult.forcingOverlap;
    }

    set({
      clips: clips.map(c => {
        if (c.id === id) return { ...c, startTime: Math.max(0, finalStartTime), trackId: actualTrackId };
        if (!skipLinked && (c.id === movingClip.linkedClipId || c.linkedClipId === id)) {
          return { ...c, startTime: Math.max(0, linkedFinalTime) };
        }
        if (!skipGroup && groupClips.some(gc => gc.id === c.id)) {
          const groupResult = getPositionWithResistance(c.id, c.startTime + timeDelta, c.trackId, c.duration);
          return { ...c, startTime: Math.max(0, groupResult.startTime) };
        }
        return c;
      }),
    });

    if (forcingOverlap && !skipTrim) trimOverlappingClips(id, finalStartTime, actualTrackId, movingClip.duration, excludeClipIds);
    if (linkedForcingOverlap && linkedClip && !skipLinked && !skipTrim) {
      trimOverlappingClips(linkedClip.id, linkedFinalTime, linkedClip.trackId, linkedClip.duration, excludeClipIds);
    }

    updateDuration();
    invalidateCache();
  },

  trimClip: (id, inPoint, outPoint) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot trim clip on locked track', { id });
      return;
    }
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return clearProcessedAudioAnalysisRefs({ ...c, inPoint, outPoint, duration: outPoint - inPoint });
      }),
    });
    updateDuration();
    invalidateCache();
  },

  splitClip: (clipId, splitTime) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    if (isClipOnLockedTrack(clips, tracks, clipId) || (clip.linkedClipId && isClipOnLockedTrack(clips, tracks, clip.linkedClipId))) {
      log.warn('Cannot split clip on locked track', { clipId });
      return;
    }

    const clipEnd = clip.startTime + clip.duration;
    if (splitTime <= clip.startTime || splitTime >= clipEnd) {
      log.warn('Cannot split at edge or outside clip');
      return;
    }

    const firstPartDuration = splitTime - clip.startTime;
    const secondPartDuration = clip.duration - firstPartDuration;
    const splitInSource = clip.inPoint + firstPartDuration;

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substr(2, 5);

    // Create new video/audio elements for the second clip to avoid sharing HTMLMediaElements
    // This is critical: both clips need their own elements for independent seeking/playback
    let secondClipSource = clip.source;
    if (clip.source?.type === 'video' && clip.source.videoElement && clip.file) {
      const newVideo = createVideoElement(clip.file);
      secondClipSource = {
        ...clip.source,
        videoElement: newVideo,
        // Share WebCodecsPlayer with clip1 — both clips are from the same source
        // and never overlap (same track), so one decoder handles both.
        // advanceToTime already handles time jumps at cut boundaries.
        // This avoids async re-parsing the MP4 and creating a second decoder
        // that could crash or race with the first.
        webCodecsPlayer: clip.source.webCodecsPlayer,
      };
    } else if (clip.source?.type === 'audio' && clip.source.audioElement && clip.file) {
      // Handle audio-only clips - create new audio element for second clip
      const newAudio = createAudioElement(clip.file);
      secondClipSource = {
        ...clip.source,
        audioElement: newAudio,
      };
    }

    const firstClip: TimelineClip = {
      ...clip,
      ...deepCloneClipProps(clip),
      id: `clip-${timestamp}-${randomSuffix}-a`,
      duration: firstPartDuration,
      outPoint: splitInSource,
      linkedClipId: undefined,
      transitionOut: undefined,
    };

    const secondClip: TimelineClip = {
      ...clip,
      ...deepCloneClipProps(clip),
      id: `clip-${timestamp}-${randomSuffix}-b`,
      startTime: splitTime,
      duration: secondPartDuration,
      inPoint: splitInSource,
      linkedClipId: undefined,
      source: secondClipSource,
      transitionIn: undefined,
    };

    const newClips: TimelineClip[] = clips.filter(c => c.id !== clipId && c.id !== clip.linkedClipId);

    if (clip.linkedClipId) {
      const linkedClip = clips.find(c => c.id === clip.linkedClipId);
      if (linkedClip) {
        // Create new audio element for linked second clip
        let linkedSecondSource = linkedClip.source;
        if (linkedClip.source?.type === 'audio' && linkedClip.source.audioElement) {
          // For composition audio clips, use mixdownBuffer to create new audio element
          if (linkedClip.mixdownBuffer) {
            // Async create audio from mixdown buffer
            import('../../services/compositionAudioMixer').then(({ compositionAudioMixer }) => {
              const newAudio = compositionAudioMixer.createAudioElement(linkedClip.mixdownBuffer!);
              const { clips: currentClips } = get();
              const linkedSecondClipId = `clip-${timestamp}-${randomSuffix}-linked-b`;
              set({
                clips: currentClips.map(c => {
                  if (c.id !== linkedSecondClipId || !c.source) return c;
                  return { ...c, source: { ...c.source, audioElement: newAudio } };
                }),
              });
            });
            // Source will be updated async, use existing for now
            linkedSecondSource = { ...linkedClip.source };
          } else if (linkedClip.file && linkedClip.file.size > 0) {
            // Regular audio file (not empty composition placeholder)
            const newAudio = createAudioElement(linkedClip.file);
            linkedSecondSource = {
              ...linkedClip.source,
              audioElement: newAudio,
            };
          }
        }

        const linkedFirstClip: TimelineClip = {
          ...linkedClip,
          ...deepCloneClipProps(linkedClip),
          id: `clip-${timestamp}-${randomSuffix}-linked-a`,
          duration: firstPartDuration,
          outPoint: linkedClip.inPoint + firstPartDuration,
          linkedClipId: firstClip.id,
        };
        const linkedSecondClip: TimelineClip = {
          ...linkedClip,
          ...deepCloneClipProps(linkedClip),
          id: `clip-${timestamp}-${randomSuffix}-linked-b`,
          startTime: splitTime,
          duration: secondPartDuration,
          inPoint: linkedClip.inPoint + firstPartDuration,
          linkedClipId: secondClip.id,
          source: linkedSecondSource,
        };
        firstClip.linkedClipId = linkedFirstClip.id;
        secondClip.linkedClipId = linkedSecondClip.id;
        newClips.push(linkedFirstClip, linkedSecondClip);
      }
    }

    newClips.push(firstClip, secondClip);
    set({ clips: newClips, selectedClipIds: new Set([secondClip.id]) });
    updateDuration();
    invalidateCache();
    log.debug('Split clip', { clip: clip.name, splitTime: splitTime.toFixed(2) });
  },

  splitClipAtPlayhead: () => {
    const { clips, playheadPosition, selectedClipIds, splitClip } = get();
    const clipsAtPlayhead = clips.filter(c =>
      playheadPosition > c.startTime && playheadPosition < c.startTime + c.duration
    );

    if (clipsAtPlayhead.length === 0) {
      log.warn('No clip at playhead position');
      return;
    }

    let clipsToSplit = selectedClipIds.size > 0
      ? clipsAtPlayhead.filter(c => selectedClipIds.has(c.id))
      : clipsAtPlayhead;

    if (clipsToSplit.length === 0) clipsToSplit = clipsAtPlayhead;

    const linkedClipIds = new Set(clipsToSplit.map(c => c.linkedClipId).filter(Boolean));
    const clipsToSplitFiltered = clipsToSplit.filter(c => !linkedClipIds.has(c.id));

    for (const clip of clipsToSplitFiltered) {
      splitClip(clip.id, playheadPosition);
    }
  },

  updateClip: (id, updates) => {
    const { clips, tracks, updateDuration } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot update clip on locked track', { id });
      return;
    }
    set({ clips: clips.map(c => c.id === id ? applyClipUpdatesWithAudioAnalysisInvalidation(c, updates) : c) });
    updateDuration();
  },

  updateClipTransform: (id, transform) => {
    const { clips, tracks, invalidateCache } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot update clip transform on locked track', { id });
      return;
    }
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return {
          ...c,
          transform: {
            ...c.transform,
            ...transform,
            position: transform.position ? { ...c.transform.position, ...transform.position } : c.transform.position,
            scale: transform.scale ? { ...c.transform.scale, ...transform.scale } : c.transform.scale,
            rotation: transform.rotation ? { ...c.transform.rotation, ...transform.rotation } : c.transform.rotation,
          },
        };
      }),
    });
    invalidateCache();
  },

  toggleClipReverse: (id) => {
    const { clips, tracks, invalidateCache } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot reverse clip on locked track', { id });
      return;
    }
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return {
          ...clearProcessedAudioAnalysisRefs(c),
          reversed: !c.reversed,
        };
      }),
    });
    invalidateCache();
  },

  // ========== WAVEFORM GENERATION ==========

  cancelAudioAnalysisForClip: (clipId: string) => {
    const cancelled = clipAudioAnalysisJobService.cancelClip(clipId);
    if (cancelled === 0) return;
    set({
      clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()),
    });
  },

  generateWaveformForClip: async (clipId: string, options: GenerateClipAudioAnalysisOptions = {}) => {
    const { clips } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;
    const includePyramid = options.previewOnly !== true;

    set({
      clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
        kind: 'waveform-pyramid',
        label: includePyramid ? 'Waveform' : 'Waveform Preview',
        artifactKinds: includePyramid ? ['waveform-pyramid'] : [],
        processed: false,
      })),
    });
    log.debug('Starting waveform generation', { clip: clip.name, includePyramid });

    try {
      await clipAudioAnalysisJobService.run({ clipId, kind: 'waveform-pyramid' }, async ({ signal }) => {
        set({
          clips: updateAudioAnalysisJobProgress(get().clips, clipId, 1, 'preparing', 'Preparing waveform'),
        });
        let waveform: number[];
        let waveformChannels: number[][] | undefined;
        let audioAnalysisRefs: import('../../types/audio').MediaFileAudioAnalysisRefs | undefined;

        if (clip.isComposition && clip.compositionId) {
          const { compositionAudioMixer } = await import('../../services/compositionAudioMixer');
          const mixdownResult = await compositionAudioMixer.mixdownComposition(clip.compositionId);
          if (signal.aborted) throw signal.reason;

          if (mixdownResult?.hasAudio) {
            waveform = mixdownResult.waveform;
            const mixdownAudio = compositionAudioMixer.createAudioElement(mixdownResult.buffer);
            set({
              clips: updateClipById(get().clips, clipId, {
                source: { type: 'audio' as const, audioElement: mixdownAudio, naturalDuration: mixdownResult.duration },
                mixdownBuffer: mixdownResult.buffer,
                hasMixdownAudio: true,
              }),
            });
          } else if (clip.mixdownBuffer) {
            waveform = generateWaveformFromBuffer(clip.mixdownBuffer, 50);
          } else {
            waveform = new Array(Math.max(1, Math.floor(clip.duration * 50))).fill(0);
          }
        } else {
          const sourceFile = await resolveClipSourceFile(clip);
          if (!sourceFile) {
            log.warn('No file found for clip', { clipId });
            set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
            return;
          }

          set({ clips: updateClipById(get().clips, clipId, { file: sourceFile }) });
          const analysis = await generateTimelineWaveformAnalysisForFile(sourceFile, {
            mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
            includePyramid,
            signal,
            onProgress: (progress, partialWaveform) => {
              set({
                clips: updateAudioAnalysisJobProgress(
                  updateClipById(get().clips, clipId, { waveform: partialWaveform }),
                  clipId,
                  progress,
                  'analyzing',
                ),
              });
            },
            onPyramidProgress: (progress) => {
              set({
                clips: updateAudioAnalysisJobProgress(
                  get().clips,
                  clipId,
                  Math.min(98, Math.round(progress.percent)),
                  progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
                  progress.message,
                ),
              });
            },
          });
          waveform = analysis.waveform;
          waveformChannels = analysis.waveformChannels;
          audioAnalysisRefs = analysis.audioAnalysisRefs;
        }

        if (signal.aborted) throw signal.reason;
        log.debug('Waveform complete', { samples: waveform.length, clip: clip.name });
        const currentClip = get().clips.find(c => c.id === clipId);
        set({ clips: updateClipById(get().clips, clipId, {
          waveform,
          waveformChannels,
          ...(audioAnalysisRefs
            ? {
                audioState: {
                  ...(currentClip?.audioState ?? {}),
                  sourceAnalysisRefs: {
                    ...(currentClip?.audioState?.sourceAnalysisRefs ?? {}),
                    ...audioAnalysisRefs,
                  },
                },
              }
            : {}),
          ...clearAudioAnalysisJobUpdate(),
          waveformProgress: 100,
        }) });
      });
    } catch (e) {
      if (isAudioAnalysisCancellation(e)) {
        log.debug('Waveform generation cancelled', { clipId });
      } else {
        log.error('Waveform generation failed', e);
      }
      set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    }
  },

  generateProcessedWaveformForClip: async (clipId: string, options: GenerateClipAudioAnalysisOptions = {}) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    if (!clipRequiresProcessedWaveformPyramid(clip, keyframes)) {
      return;
    }
    if (!options.force && clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId) {
      return;
    }

    set({
      clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
        kind: 'processed-waveform-pyramid',
        label: 'Processed Waveform',
        artifactKinds: ['processed-waveform-pyramid'],
        processed: true,
      })),
    });
    log.debug('Starting processed waveform generation', { clip: clip.name });

    try {
      await clipAudioAnalysisJobService.run({ clipId, kind: 'processed-waveform-pyramid' }, async ({ signal }) => {
        set({
          clips: updateAudioAnalysisJobProgress(get().clips, clipId, 1, 'preparing', 'Preparing processed waveform'),
        });
        let sourceBuffer: AudioBuffer | null = null;
        let sourceFingerprint = '';
        let mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;

        if (clip.isComposition && clip.compositionId) {
          if (clip.mixdownBuffer) {
            sourceBuffer = clip.mixdownBuffer;
          } else {
            const { compositionAudioMixer } = await import('../../services/compositionAudioMixer');
            const mixdownResult = await compositionAudioMixer.mixdownComposition(clip.compositionId);
            if (signal.aborted) throw signal.reason;
            if (mixdownResult?.hasAudio) {
              sourceBuffer = mixdownResult.buffer;
              set({
                clips: updateClipById(get().clips, clipId, {
                  mixdownBuffer: mixdownResult.buffer,
                  hasMixdownAudio: true,
                }),
              });
            }
          }

          if (sourceBuffer) {
            sourceFingerprint = [
              'composition-mixdown',
              clip.compositionId,
              clip.nestedContentHash ?? 'unknown-content',
              sourceBuffer.sampleRate,
              sourceBuffer.length,
              Number(sourceBuffer.duration.toFixed(6)),
            ].join(':');
            mediaFileId = mediaFileId ?? clip.compositionId;
          }
        } else {
          const sourceFile = await resolveClipSourceFile(clip);
          if (sourceFile) {
            mediaFileId = mediaFileId ?? `file:${sourceFile.name}:${sourceFile.size}:${sourceFile.lastModified}`;
            set({ clips: updateClipById(get().clips, clipId, { file: sourceFile }) });
            sourceFingerprint = await createFileAudioSourceFingerprint(sourceFile);
            if (signal.aborted) throw signal.reason;
            sourceBuffer = await audioExtractor.extractAudio(sourceFile, mediaFileId);
            if (signal.aborted) throw signal.reason;
          }
        }

        if (!sourceBuffer) {
          log.warn('No audio source found for processed waveform', { clipId });
          set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
          return;
        }

        const service = new ProcessedWaveformPyramidService();
        const result = await service.generate({
          clip,
          sourceBuffer,
          sourceFingerprint,
          mediaFileId,
          keyframes,
          signal,
          onProgress: (progress) => {
            set({
              clips: updateAudioAnalysisJobProgress(
                get().clips,
                clipId,
                progress.percent,
                progress.phase === 'waveform' ? 'analyzing' : 'rendering-processed-audio',
                progress.message,
              ),
            });
          },
        });

        const currentClip = get().clips.find(c => c.id === clipId);
        if (!currentClip) return;
        if (createProcessedClipAudioStateHash(currentClip, { keyframes }) !== result.clipAudioStateHash) {
          log.debug('Discarding stale processed waveform result', { clipId });
          set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
          return;
        }

        set({
          clips: updateClipById(get().clips, clipId, {
            ...(currentClip.waveform?.length ? {} : { waveform: result.waveform }),
            audioState: {
              ...(currentClip.audioState ?? {}),
              processedAnalysisRefs: {
                ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
                ...result.audioAnalysisRefs,
              },
            },
            ...clearAudioAnalysisJobUpdate(),
            waveformProgress: 100,
          }),
        });
        log.debug('Processed waveform complete', {
          clip: clip.name,
          artifactId: result.artifact.id,
        });
      });
    } catch (e) {
      if (isAudioAnalysisCancellation(e)) {
        log.debug('Processed waveform generation cancelled', { clipId });
      } else {
        log.error('Processed waveform generation failed', e);
      }
      set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    }
  },

  generateSpectrogramForClip: async (clipId: string, options: GenerateClipAudioAnalysisOptions = {}) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    const needsProcessedSpectrogram = clipRequiresProcessedWaveformPyramid(clip, keyframes);
    if (!options.force && needsProcessedSpectrogram && clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0]) {
      return;
    }
    if (!options.force && !needsProcessedSpectrogram && clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0]) {
      return;
    }

    set({
      clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
        kind: 'spectrogram-tiles',
        label: 'Spectrogram',
        artifactKinds: ['spectrogram-tiles'],
        processed: needsProcessedSpectrogram,
      })),
    });
    log.debug('Starting spectrogram generation', {
      clip: clip.name,
      processed: needsProcessedSpectrogram,
    });

    try {
      await clipAudioAnalysisJobService.run({ clipId, kind: 'spectrogram-tiles' }, async ({ signal }) => {
      const prepared = await prepareClipAudioAnalysisInput({
        clip,
        keyframes,
        needsProcessed: needsProcessedSpectrogram,
        signal,
        onMixdownReady: (buffer) => {
          set({
            clips: updateClipById(get().clips, clipId, {
              mixdownBuffer: buffer,
              hasMixdownAudio: true,
            }),
          });
        },
        onRenderProgress: (progress) => {
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              Math.min(66, Math.round(progress.percent * 0.66)),
              'rendering-processed-audio',
              progress.message,
            ),
          });
        },
      });

      if (!prepared) {
        log.warn('No audio source found for spectrogram', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const store = createCurrentAudioArtifactStore();
      const generator = new SpectrogramTileSetGenerator({ artifactStore: store });
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => {
          const base = needsProcessedSpectrogram ? 66 : 0;
          const scale = needsProcessedSpectrogram ? 0.32 : 0.98;
          const nextProgress = Math.min(98, Math.round(base + progress.percent * scale));
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              nextProgress,
              progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
              progress.message,
            ),
          });
        },
      });
      const tileSet = await readTimelineSpectrogramTileSet(generated.manifest, store);

      primeTimelineSpectrogramTileSetCache([
        generated.artifact.id,
        generated.artifact.manifestRef.artifactId,
        generated.analysisRef.artifactId,
      ], tileSet);

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip) return;
      if (isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        log.debug('Discarding stale processed spectrogram result', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const refId = generated.artifact.manifestRef.artifactId;
      set({
        clips: updateClipById(get().clips, clipId, {
          audioState: {
            ...(currentClip.audioState ?? {}),
            ...(needsProcessedSpectrogram
              ? {
                  processedAnalysisRefs: {
                    ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
                    spectrogramTileSetIds: [refId],
                  },
                }
              : {
                  sourceAnalysisRefs: {
                    ...(currentClip.audioState?.sourceAnalysisRefs ?? {}),
                    spectrogramTileSetIds: [refId],
                  },
                }),
          },
          ...clearAudioAnalysisJobUpdate(),
          waveformProgress: 100,
        }),
      });

      log.debug('Spectrogram generation complete', {
        clip: clip.name,
        artifactId: generated.artifact.id,
        processed: needsProcessedSpectrogram,
      });
      });
    } catch (e) {
      if (isAudioAnalysisCancellation(e)) {
        log.debug('Spectrogram generation cancelled', { clipId });
      } else {
        log.error('Spectrogram generation failed', e);
      }
      set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    }
  },

  generateLoudnessForClip: async (clipId: string, options: GenerateClipAudioAnalysisOptions = {}) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    const needsProcessedLoudness = clipRequiresProcessedWaveformPyramid(clip, keyframes);
    if (!options.force && needsProcessedLoudness && clip.audioState?.processedAnalysisRefs?.loudnessEnvelopeId) {
      return;
    }
    if (!options.force && !needsProcessedLoudness && clip.audioState?.sourceAnalysisRefs?.loudnessEnvelopeId) {
      return;
    }

    set({
      clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
        kind: 'loudness-envelope',
        label: 'Loudness',
        artifactKinds: ['loudness-envelope'],
        processed: needsProcessedLoudness,
      })),
    });
    log.debug('Starting loudness generation', {
      clip: clip.name,
      processed: needsProcessedLoudness,
    });

    try {
      await clipAudioAnalysisJobService.run({ clipId, kind: 'loudness-envelope' }, async ({ signal }) => {
      const prepared = await prepareClipAudioAnalysisInput({
        clip,
        keyframes,
        needsProcessed: needsProcessedLoudness,
        signal,
        onMixdownReady: (buffer) => {
          set({
            clips: updateClipById(get().clips, clipId, {
              mixdownBuffer: buffer,
              hasMixdownAudio: true,
            }),
          });
        },
        onRenderProgress: (progress) => {
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              Math.min(66, Math.round(progress.percent * 0.66)),
              'rendering-processed-audio',
              progress.message,
            ),
          });
        },
      });

      if (!prepared) {
        log.warn('No audio source found for loudness', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const store = createCurrentAudioArtifactStore();
      const generator = new LoudnessEnvelopeGenerator({ artifactStore: store });
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => {
          const base = needsProcessedLoudness ? 66 : 0;
          const scale = needsProcessedLoudness ? 0.32 : 0.98;
          const nextProgress = Math.min(98, Math.round(base + progress.percent * scale));
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              nextProgress,
              progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
              progress.message,
            ),
          });
        },
      });
      const envelope = await readTimelineLoudnessEnvelope(generated.manifest, store);

      primeTimelineLoudnessEnvelopeCache([
        generated.artifact.id,
        generated.artifact.manifestRef.artifactId,
        generated.analysisRef.artifactId,
      ], envelope);

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip) return;
      if (isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        log.debug('Discarding stale processed loudness result', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const refId = generated.artifact.manifestRef.artifactId;
      set({
        clips: updateClipById(get().clips, clipId, {
          audioState: {
            ...(currentClip.audioState ?? {}),
            ...(needsProcessedLoudness
              ? {
                  processedAnalysisRefs: {
                    ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
                    loudnessEnvelopeId: refId,
                  },
                }
              : {
                  sourceAnalysisRefs: {
                    ...(currentClip.audioState?.sourceAnalysisRefs ?? {}),
                    loudnessEnvelopeId: refId,
                  },
                }),
          },
          ...clearAudioAnalysisJobUpdate(),
          waveformProgress: 100,
        }),
      });

      log.debug('Loudness generation complete', {
        clip: clip.name,
        artifactId: generated.artifact.id,
        processed: needsProcessedLoudness,
      });
      });
    } catch (e) {
      if (isAudioAnalysisCancellation(e)) {
        log.debug('Loudness generation cancelled', { clipId });
      } else {
        log.error('Loudness generation failed', e);
      }
      set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    }
  },

  generateBeatOnsetForClip: async (clipId: string, options: GenerateClipAudioAnalysisOptions = {}) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    const needsProcessedBeatOnset = clipRequiresProcessedWaveformPyramid(clip, keyframes);
    const currentRefs = needsProcessedBeatOnset
      ? clip.audioState?.processedAnalysisRefs
      : clip.audioState?.sourceAnalysisRefs;
    if (!options.force && currentRefs?.beatGridId && currentRefs.onsetMapId) {
      return;
    }

    set({
      clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
        kind: 'beat-onset-analysis',
        label: 'Beat/Onset',
        artifactKinds: ['beat-grid', 'onset-map'],
        processed: needsProcessedBeatOnset,
      })),
    });
    log.debug('Starting beat/onset analysis', {
      clip: clip.name,
      processed: needsProcessedBeatOnset,
    });

    try {
      await clipAudioAnalysisJobService.run({ clipId, kind: 'beat-onset-analysis' }, async ({ signal }) => {
      const prepared = await prepareClipAudioAnalysisInput({
        clip,
        keyframes,
        needsProcessed: needsProcessedBeatOnset,
        signal,
        onMixdownReady: (buffer) => {
          set({
            clips: updateClipById(get().clips, clipId, {
              mixdownBuffer: buffer,
              hasMixdownAudio: true,
            }),
          });
        },
        onRenderProgress: (progress) => {
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              Math.min(66, Math.round(progress.percent * 0.66)),
              'rendering-processed-audio',
              progress.message,
            ),
          });
        },
      });

      if (!prepared) {
        log.warn('No audio source found for beat/onset analysis', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const store = createCurrentAudioArtifactStore();
      const generator = new BeatOnsetAnalysisGenerator({ artifactStore: store });
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => {
          const base = needsProcessedBeatOnset ? 66 : 0;
          const scale = needsProcessedBeatOnset ? 0.32 : 0.98;
          const nextProgress = Math.min(98, Math.round(base + progress.percent * scale));
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              nextProgress,
              progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
              progress.message,
            ),
          });
        },
      });

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip) return;
      if (isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        log.debug('Discarding stale processed beat/onset result', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const beatGridId = generated.beatArtifact.manifestRef.artifactId;
      const onsetMapId = generated.onsetArtifact.manifestRef.artifactId;
      const [beatGrid, onsetMap] = await Promise.all([
        readTimelineBeatGrid(generated.beatManifest, store),
        readTimelineOnsetMap(generated.onsetManifest, store),
      ]);
      primeTimelineBeatGridCache([
        beatGridId,
        generated.beatArtifact.id,
        generated.beatArtifact.manifestRef.artifactId,
      ], beatGrid);
      primeTimelineOnsetMapCache([
        onsetMapId,
        generated.onsetArtifact.id,
        generated.onsetArtifact.manifestRef.artifactId,
      ], onsetMap);
      set({
        clips: updateClipById(get().clips, clipId, {
          audioState: {
            ...(currentClip.audioState ?? {}),
            ...(needsProcessedBeatOnset
              ? {
                  processedAnalysisRefs: {
                    ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
                    beatGridId,
                    onsetMapId,
                  },
                }
              : {
                  sourceAnalysisRefs: {
                    ...(currentClip.audioState?.sourceAnalysisRefs ?? {}),
                    beatGridId,
                    onsetMapId,
                  },
                }),
          },
          ...clearAudioAnalysisJobUpdate(),
          waveformProgress: 100,
        }),
      });

      log.debug('Beat/onset analysis complete', {
        clip: clip.name,
        beatArtifactId: generated.beatArtifact.id,
        onsetArtifactId: generated.onsetArtifact.id,
        processed: needsProcessedBeatOnset,
      });
      });
    } catch (e) {
      if (isAudioAnalysisCancellation(e)) {
        log.debug('Beat/onset analysis cancelled', { clipId });
      } else {
        log.error('Beat/onset analysis failed', e);
      }
      set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    }
  },

  generateFrequencyPhaseForClip: async (clipId: string, options: GenerateClipAudioAnalysisOptions = {}) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || clip.waveformGenerating) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    const needsProcessedFrequencyPhase = clipRequiresProcessedWaveformPyramid(clip, keyframes);
    const currentRefs = needsProcessedFrequencyPhase
      ? clip.audioState?.processedAnalysisRefs
      : clip.audioState?.sourceAnalysisRefs;
    if (!options.force && currentRefs?.frequencySummaryId && currentRefs.phaseCorrelationId) {
      return;
    }

    set({
      clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
        kind: 'frequency-phase-analysis',
        label: 'Frequency/Phase',
        artifactKinds: ['frequency-summary', 'phase-correlation'],
        processed: needsProcessedFrequencyPhase,
      })),
    });
    log.debug('Starting frequency/phase analysis', {
      clip: clip.name,
      processed: needsProcessedFrequencyPhase,
    });

    try {
      await clipAudioAnalysisJobService.run({ clipId, kind: 'frequency-phase-analysis' }, async ({ signal }) => {
      const prepared = await prepareClipAudioAnalysisInput({
        clip,
        keyframes,
        needsProcessed: needsProcessedFrequencyPhase,
        signal,
        onMixdownReady: (buffer) => {
          set({
            clips: updateClipById(get().clips, clipId, {
              mixdownBuffer: buffer,
              hasMixdownAudio: true,
            }),
          });
        },
        onRenderProgress: (progress) => {
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              Math.min(66, Math.round(progress.percent * 0.66)),
              'rendering-processed-audio',
              progress.message,
            ),
          });
        },
      });

      if (!prepared) {
        log.warn('No audio source found for frequency/phase analysis', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const store = createCurrentAudioArtifactStore();
      const generator = new FrequencyPhaseAnalysisGenerator({ artifactStore: store });
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => {
          const base = needsProcessedFrequencyPhase ? 66 : 0;
          const scale = needsProcessedFrequencyPhase ? 0.32 : 0.98;
          const nextProgress = Math.min(98, Math.round(base + progress.percent * scale));
          set({
            clips: updateAudioAnalysisJobProgress(
              get().clips,
              clipId,
              nextProgress,
              progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
              progress.message,
            ),
          });
        },
      });
      const [frequencySummary, phaseCorrelation] = await Promise.all([
        readTimelineFrequencySummary(generated.frequencyManifest, store),
        readTimelinePhaseCorrelation(generated.phaseManifest, store),
      ]);
      primeTimelineFrequencySummaryCache([
        generated.frequencyArtifact.id,
        generated.frequencyArtifact.manifestRef.artifactId,
        generated.frequencyAnalysisRef.artifactId,
      ], frequencySummary);
      primeTimelinePhaseCorrelationCache([
        generated.phaseArtifact.id,
        generated.phaseArtifact.manifestRef.artifactId,
        generated.phaseAnalysisRef.artifactId,
      ], phaseCorrelation);

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip) return;
      if (isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        log.debug('Discarding stale processed frequency/phase result', { clipId });
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }

      const frequencySummaryId = generated.frequencyArtifact.manifestRef.artifactId;
      const phaseCorrelationId = generated.phaseArtifact.manifestRef.artifactId;
      set({
        clips: updateClipById(get().clips, clipId, {
          audioState: {
            ...(currentClip.audioState ?? {}),
            ...(needsProcessedFrequencyPhase
              ? {
                  processedAnalysisRefs: {
                    ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
                    frequencySummaryId,
                    phaseCorrelationId,
                  },
                }
              : {
                  sourceAnalysisRefs: {
                    ...(currentClip.audioState?.sourceAnalysisRefs ?? {}),
                    frequencySummaryId,
                    phaseCorrelationId,
                  },
                }),
          },
          ...clearAudioAnalysisJobUpdate(),
          waveformProgress: 100,
        }),
      });

      log.debug('Frequency/phase analysis complete', {
        clip: clip.name,
        frequencyArtifactId: generated.frequencyArtifact.id,
        phaseArtifactId: generated.phaseArtifact.id,
        processed: needsProcessedFrequencyPhase,
      });
      });
    } catch (e) {
      if (isAudioAnalysisCancellation(e)) {
        log.debug('Frequency/phase analysis cancelled', { clipId });
      } else {
        log.error('Frequency/phase analysis failed', e);
      }
      set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    }
  },

  // ========== PARENTING (PICK WHIP) ==========

  setClipParent: (clipId: string, parentClipId: string | null) => {
    const { clips, tracks } = get();
    if (isClipOnLockedTrack(clips, tracks, clipId)) {
      log.warn('Cannot parent clip on locked track', { clipId });
      return;
    }
    if (parentClipId === clipId) {
      log.warn('Cannot parent clip to itself');
      return;
    }

    if (parentClipId) {
      const wouldCreateCycle = (checkId: string): boolean => {
        const check = clips.find(c => c.id === checkId);
        if (!check?.parentClipId) return false;
        if (check.parentClipId === clipId) return true;
        return wouldCreateCycle(check.parentClipId);
      };
      if (wouldCreateCycle(parentClipId)) {
        log.warn('Cannot create circular parent reference');
        return;
      }
    }

    set({ clips: clips.map(c => c.id === clipId ? { ...c, parentClipId: parentClipId || undefined } : c) });
    log.debug('Set clip parent', { clipId, parentClipId: parentClipId || 'none' });
  },

  getClipChildren: (clipId: string) => {
    return get().clips.filter(c => c.parentClipId === clipId);
  },

  setClipPreservesPitch: (clipId: string, preservesPitch: boolean) => {
    const { clips, tracks } = get();
    if (isClipOnLockedTrack(clips, tracks, clipId)) {
      log.warn('Cannot update clip pitch on locked track', { clipId });
      return;
    }
    set({
      clips: get().clips.map(c => {
        if (c.id !== clipId) return c;
        return clearProcessedAudioAnalysisRefs({ ...c, preservesPitch });
      }),
    });
  },

  // Refresh nested clips when source composition changes
  refreshCompClipNestedData: async (sourceCompositionId: string) => {
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

    // Find all comp clips that reference this composition
    const compClips = clips.filter(c => c.isComposition && c.compositionId === sourceCompositionId);
    if (compClips.length === 0) {
      log.info('No comp clips found referencing this composition');
      return;
    }

    // Get the updated composition
    const { useMediaStore } = await import('../mediaStore');
    const composition = useMediaStore.getState().compositions.find(c => c.id === sourceCompositionId);
    if (!composition?.timelineData) {
      log.debug('No timelineData for composition', { sourceCompositionId });
      return;
    }

    // Create a content hash to detect changes (clips, effects, duration)
    const newContentHash = createNestedContentHash(composition.timelineData);

    log.info('Refreshing nested clips for composition', {
      compositionId: sourceCompositionId,
      compositionName: composition.name,
      affectedClips: compClips.length,
      newClipCount: composition.timelineData.clips.length,
      newTrackCount: composition.timelineData.tracks.length,
    });

    // Reload nested clips for each comp clip
    for (const compClip of compClips) {
      if (!isCurrentTimelineSession()) {
        return;
      }
      // Check if content actually changed (compare hashes)
      const oldContentHash = compClip.nestedContentHash;
      const needsThumbnailUpdate = oldContentHash !== newContentHash;

      // Load updated nested clips
      const nestedClips = await loadNestedClips({
        compClipId: compClip.id,
        composition,
        get,
        set,
      });
      if (!isCurrentTimelineSession()) {
        return;
      }
      const nestedTracks = composition.timelineData.tracks;
      const compDuration = composition.timelineData?.duration ?? composition.duration;

      // Calculate clip boundaries for visual markers
      const nestedClipBoundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

      // Update the comp clip with new nested data, content hash, and boundaries
      // IMPORTANT: Preserve existing clipSegments if no thumbnail update needed
      set({
        clips: get().clips.map(c =>
          c.id === compClip.id
            ? {
                ...c,
                nestedClips,
                nestedTracks,
                nestedContentHash: newContentHash,
                nestedClipBoundaries,
                // Keep existing clipSegments if not regenerating
                clipSegments: needsThumbnailUpdate ? undefined : c.clipSegments,
              }
            : c
        ),
      });

      // Only regenerate thumbnails if content actually changed
      if (needsThumbnailUpdate && get().thumbnailsEnabled) {
        // Wait a bit for nested clip sources to load, then build segments
        setTimeout(async () => {
          if (!isCurrentTimelineSession()) {
            return;
          }
          // Get fresh nested clips (they may have updated sources now)
          const freshCompClip = get().clips.find(c => c.id === compClip.id);
          if (!freshCompClip) {
            return;
          }
          const freshNestedClips = freshCompClip?.nestedClips || nestedClips;

          const clipSegments = await buildClipSegments(
            composition.timelineData,
            compDuration,
            freshNestedClips
          );

          if (!isCurrentTimelineSession()) {
            return;
          }
          if (clipSegments.length > 0) {
            set({
              clips: get().clips.map(c =>
                c.id === compClip.id ? { ...c, clipSegments } : c
              ),
            });
            log.info('Updated clip segments for nested comp', {
              clipId: compClip.id,
              segmentCount: clipSegments.length,
            });
          }
        }, 500); // Wait for video elements to load
      } else {
        log.debug('Skipped segment regeneration (no content change or thumbnails disabled)', {
          compClipId: compClip.id,
        });
      }
    }

    if (!isCurrentTimelineSession()) {
      return;
    }
    invalidateCache();
  },

  toggle3D: (clipId: string) => {
    const { clips, tracks, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    if (isClipOnLockedTrack(clips, tracks, clipId)) {
      log.warn('Cannot toggle 3D on locked track', { clipId });
      return;
    }
    if (clip.source?.type === 'gaussian-splat') {
      return;
    }

    const nowIs3D = !clip.is3D;
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        if (nowIs3D) {
          if (isPlaneClip(c)) {
            const t = c.transform || DEFAULT_TRANSFORM;
            const currentZ = t.position?.z ?? DEFAULT_TRANSFORM.position.z;
            return {
              ...c,
              is3D: true,
              transform: {
                ...t,
                position: {
                  ...(t.position || DEFAULT_TRANSFORM.position),
                  z: currentZ,
                },
                rotation: { ...(t.rotation || DEFAULT_TRANSFORM.rotation) },
                scale: { ...(t.scale || DEFAULT_TRANSFORM.scale) },
              },
            };
          }
          // Turning on 3D for existing scene-native clips keeps existing values.
          return { ...c, is3D: true };
        }
        // Turning off 3D — reset 3D-specific values to 0
        const t = c.transform || DEFAULT_TRANSFORM;
        return {
          ...c,
          is3D: false,
          transform: {
            ...t,
            position: { ...(t.position || { x: 0, y: 0, z: 0 }), z: 0 },
            rotation: { ...(t.rotation || { x: 0, y: 0, z: 0 }), x: 0, y: 0 },
            scale: { x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 },
          },
        };
      }),
    });
    invalidateCache();
  },
});
