import type { TimelineClip, TimelineTrack } from '../../../types';
import type { AddClipOptions } from '../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { Logger } from '../../../services/logger';
import { classifyMediaType } from '../helpers/mediaTypeHelpers';
import { loadVideoMedia } from './addVideoClip';
import { createAudioClipPlaceholder, loadAudioMedia } from './addAudioClip';
import { createImageClipPlaceholder, loadImageMedia } from './addImageClip';
import { createLottieClipPlaceholder, loadLottieMedia } from './addLottieClip';
import { createRiveClipPlaceholder, loadRiveMedia } from './addRiveClip';
import { createModelClipPlaceholder, loadModelMedia } from './addModelClip';
import { createGaussianSplatClipPlaceholder, loadGaussianSplatMedia } from './addGaussianSplatClip';
import { applyAddClipOptions } from './addClipOptions';
import { generateLinkedClipIds } from '../helpers/idGenerator';
import { readLottieMetadata } from '../../../services/vectorAnimation/lottieMetadata';
import { readRiveMetadata } from '../../../services/vectorAnimation/riveMetadata';
import type { ClipActionContext } from './clipActionContext';
import {
  hasVisualMediaType,
  loadSourceMediaFile,
} from './addClipMediaSource';
import {
  createTimelineTrackForType,
  insertTimelineTrack,
} from '../trackSlice';

const log = Logger.create('ClipAddAction');

type AddClipTargetTrackType = 'video' | 'audio';

function getRequiredTrackTypeForMedia(
  mediaType: Awaited<ReturnType<typeof classifyMediaType>> | 'gaussian-avatar' | 'gaussian-splat',
): AddClipTargetTrackType | null {
  if (mediaType === 'audio') return 'audio';
  if (mediaType === 'gaussian-avatar') return null;
  if (hasVisualMediaType(mediaType)) return 'video';
  return null;
}

function isUnlockedCompatibleTrack(
  track: TimelineTrack,
  requiredTrackType: AddClipTargetTrackType,
): boolean {
  return track.type === requiredTrackType && track.locked !== true;
}

function findUnlockedCompatibleTrackId(
  tracks: readonly TimelineTrack[],
  requestedTrackId: string,
  requiredTrackType: AddClipTargetTrackType,
): string | null {
  const requestedIndex = tracks.findIndex(track => track.id === requestedTrackId);
  const searchOrder = requestedIndex >= 0
    ? [...tracks.slice(requestedIndex + 1), ...tracks.slice(0, requestedIndex)]
    : tracks;

  return searchOrder.find(track => isUnlockedCompatibleTrack(track, requiredTrackType))?.id ?? null;
}

function createUnlockedPlacementTrack(
  context: ClipActionContext,
  requiredTrackType: AddClipTargetTrackType,
): string {
  let createdTrackId = '';
  const { set } = context;
  set(state => {
    const newTrack = createTimelineTrackForType(requiredTrackType, state.tracks);
    createdTrackId = newTrack.id;
    return insertTimelineTrack(state.tracks, state.expandedTracks, newTrack);
  });
  return createdTrackId;
}

function resolveUnlockedPlacementTrackId(
  context: ClipActionContext,
  requestedTrackId: string,
  requiredTrackType: AddClipTargetTrackType,
): string | null {
  const { tracks } = context.get();
  const requestedTrack = tracks.find(track => track.id === requestedTrackId);
  if (!requestedTrack) {
    log.warn('Track not found', { trackId: requestedTrackId });
    return null;
  }

  if (isUnlockedCompatibleTrack(requestedTrack, requiredTrackType)) {
    return requestedTrack.id;
  }

  if (requestedTrack.type !== requiredTrackType) {
    return requestedTrack.id;
  }

  const fallbackTrackId = findUnlockedCompatibleTrackId(tracks, requestedTrackId, requiredTrackType);
  if (fallbackTrackId) {
    log.warn('Remapping clip placement away from locked track', {
      requestedTrackId,
      fallbackTrackId,
    });
    return fallbackTrackId;
  }

  const createdTrackId = createUnlockedPlacementTrack(context, requiredTrackType);
  log.warn('Created unlocked track for clip placement away from locked track', {
    requestedTrackId,
    createdTrackId,
    trackType: requiredTrackType,
  });
  return createdTrackId;
}

export async function applyAddClipAction(
  context: ClipActionContext,
  trackId: string,
  file: File,
  startTime: number,
  providedDuration?: number,
  mediaFileId?: string,
  mediaTypeOverride?: string,
  options?: AddClipOptions,
): Promise<string | undefined> {
  const { get, set } = context;
  const mediaType = (mediaTypeOverride as Awaited<ReturnType<typeof classifyMediaType>> | 'gaussian-avatar' | 'gaussian-splat') || await classifyMediaType(file);
  const estimatedDuration = providedDuration ?? 5;

  log.debug('Adding clip', { mediaType, file: file.name });

  const requiredTrackType = getRequiredTrackTypeForMedia(mediaType);
  const resolvedTrackId = requiredTrackType
    ? resolveUnlockedPlacementTrackId(context, trackId, requiredTrackType)
    : trackId;

  if (!resolvedTrackId) return undefined;
  trackId = resolvedTrackId;

  const { tracks, clips, updateDuration, thumbnailsEnabled, waveformsEnabled, invalidateCache } = get();
  const targetTrack = tracks.find(t => t.id === trackId);
  if (!targetTrack) {
    log.warn('Track not found', { trackId });
    return undefined;
  }

  if (mediaType === 'unknown') {
    log.warn('Unsupported clip type', { file: file.name });
    return undefined;
  }

  if (hasVisualMediaType(mediaType) && targetTrack.type !== 'video') {
    log.warn('Cannot add visual clip to audio track');
    return undefined;
  }
  if (mediaType === 'audio' && targetTrack.type !== 'audio') {
    log.warn('Cannot add audio to video track');
    return undefined;
  }

  const updateClip = (id: string, updates: Partial<TimelineClip>) => {
    set({ clips: get().clips.map(c => c.id === id ? { ...c, ...updates } : c) });
    get().updateDuration();
  };
  const setClips = (updater: (clips: TimelineClip[]) => TimelineClip[]) => {
    set({ clips: updater(get().clips) });
  };

  const sourceMediaFile = await loadSourceMediaFile(mediaFileId);
  const sourceTranscript = sourceMediaFile?.transcriptStatus === 'ready' && sourceMediaFile.transcript?.length
    ? sourceMediaFile.transcript
    : undefined;

  if (mediaType === 'video') {
    const { videoId: clipId, audioId } = generateLinkedClipIds();
    let finalAudioClipId: string | undefined;

    set(state => {
      const endTime = startTime + estimatedDuration;
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

  if (mediaType === 'audio') {
    const audioClip = applyAddClipOptions(
      createAudioClipPlaceholder({ trackId, file, startTime, estimatedDuration, mediaFileId }),
      options,
    );
    if (sourceTranscript) {
      audioClip.transcript = sourceTranscript;
      audioClip.transcriptStatus = 'ready';
    }
    set({ clips: [...clips, audioClip] });
    updateDuration();

    await loadAudioMedia({ clip: audioClip, file, mediaFileId, waveformsEnabled, updateClip });
    invalidateCache();
    return audioClip.id;
  }

  if (mediaType === 'lottie') {
    const metadata = sourceMediaFile?.vectorAnimation ?? await readLottieMetadata(file);
    const clip = applyAddClipOptions(createLottieClipPlaceholder({
      trackId,
      file,
      startTime,
      estimatedDuration: providedDuration ?? metadata.duration ?? estimatedDuration,
      mediaFileId,
      metadata,
    }), options);
    set({ clips: [...clips, clip] });
    updateDuration();
    await loadLottieMedia({ clip, file, mediaFileId, metadata, updateClip });
    invalidateCache();
    return clip.id;
  }

  if (mediaType === 'rive') {
    const metadata = sourceMediaFile?.vectorAnimation ?? await readRiveMetadata(file);
    const clip = applyAddClipOptions(createRiveClipPlaceholder({
      trackId,
      file,
      startTime,
      estimatedDuration: providedDuration ?? metadata.duration ?? estimatedDuration,
      mediaFileId,
      metadata,
    }), options);
    set({ clips: [...clips, clip] });
    updateDuration();
    await loadRiveMedia({ clip, file, mediaFileId, metadata, updateClip });
    invalidateCache();
    return clip.id;
  }

  if (mediaType === 'image') {
    const clip = applyAddClipOptions(createImageClipPlaceholder({ trackId, file, startTime, estimatedDuration, mediaFileId }), options);
    set({ clips: [...clips, clip] });
    updateDuration();
    await loadImageMedia({ clip, updateClip });
    invalidateCache();
    return clip.id;
  }

  if (mediaType === 'model') {
    const sequenceDuration = sourceMediaFile?.modelSequence
      ? (providedDuration ?? sourceMediaFile.modelSequence.frameCount / Math.max(1, sourceMediaFile.modelSequence.fps || 30))
      : undefined;
    const clip = applyAddClipOptions(createModelClipPlaceholder({
      trackId,
      file,
      startTime,
      estimatedDuration: sequenceDuration ?? providedDuration ?? 10,
      mediaFileId,
      modelSequence: sourceMediaFile?.modelSequence,
      modelUrl: sourceMediaFile?.url,
      modelFileName: sourceMediaFile?.name ?? file.name,
    }), options);
    clip.mediaFileId = mediaFileId;
    set({ clips: [...clips, clip] });
    updateDuration();
    loadModelMedia({ clip, updateClip });
    invalidateCache();
    return clip.id;
  }

  if (mediaType === 'gaussian-avatar') {
    log.warn('Legacy gaussian-avatar clips are disabled. Import a gaussian-splat scene file instead.', {
      file: file.name,
      mediaFileId,
    });
    return undefined;
  }

  if (mediaType === 'gaussian-splat') {
    const sequenceDuration = sourceMediaFile?.gaussianSplatSequence
      ? (providedDuration ?? sourceMediaFile.gaussianSplatSequence.frameCount / Math.max(1, sourceMediaFile.gaussianSplatSequence.fps || 30))
      : undefined;
    const clip = applyAddClipOptions(createGaussianSplatClipPlaceholder({
      trackId,
      file,
      startTime,
      estimatedDuration: sequenceDuration ?? providedDuration ?? 30,
      mediaFileId,
      gaussianSplatSequence: sourceMediaFile?.gaussianSplatSequence,
      gaussianSplatUrl: sourceMediaFile?.url,
      gaussianSplatFileName: sourceMediaFile?.name ?? file.name,
      gaussianSplatRuntimeKey:
        sourceMediaFile?.projectPath ??
        sourceMediaFile?.absolutePath ??
        sourceMediaFile?.filePath ??
        sourceMediaFile?.url,
    }), options);
    clip.mediaFileId = mediaFileId;
    set({ clips: [...clips, clip] });
    updateDuration();
    loadGaussianSplatMedia({ clip, updateClip });
    invalidateCache();
    return clip.id;
  }

  return undefined;
}
