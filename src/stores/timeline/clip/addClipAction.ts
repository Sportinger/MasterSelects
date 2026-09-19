import type { TimelineTrack } from '../../../types';
import type { AddClipOptions } from '../types';
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
  getPositiveFiniteDuration,
  hasVisualMediaType,
  loadActiveCompositionDimensions,
  loadSourceMediaFile,
  queueMediaSourceArtifactProjection,
} from './addClipMediaSource';
import {
  getRequiredTrackTypeForMedia,
  resolveUnlockedPlacementTrackId,
} from './unlockedPlacementTrack';
import { resolveLinkedAudioTrackId } from './linkedAudioPlacement';
import { createLinkedVideoClipPlaceholders } from './videoClipPlaceholders';
import { resolveInitialVisualTransform } from './initialVisualTransform';
import { bindRuntimeToClip } from '../../../services/mediaRuntime/clipBindings';
import { createClipRuntimeUpdateActions } from './clipRuntimeUpdateActions';
const log = Logger.create('ClipAddAction');
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

  const { setClips, updateClip } = createClipRuntimeUpdateActions(context);
  const sourceMediaFile = await loadSourceMediaFile(mediaFileId);
  const activeCompositionDimensions = options?.visualScaleMode && hasVisualMediaType(mediaType)
    ? await loadActiveCompositionDimensions()
    : undefined;
  const initialVisualTransform = resolveInitialVisualTransform(
    options,
    sourceMediaFile,
    activeCompositionDimensions,
  );
  const authoritativeNaturalDuration = getPositiveFiniteDuration(options?.source?.naturalDuration)
    ?? getPositiveFiniteDuration(sourceMediaFile?.duration);
  const sourceTranscript = sourceMediaFile?.transcriptStatus === 'ready' && sourceMediaFile.transcript?.length
    ? sourceMediaFile.transcript
    : undefined;
  if (mediaType === 'video') {
    const { videoId: clipId, audioId } = generateLinkedClipIds();
    let finalAudioClipId: string | undefined;
    const audioTrackResolution = resolveLinkedAudioTrackId(
      get().tracks,
      get().clips,
      startTime,
      estimatedDuration,
      options?.linkedAudioTrackId,
      options?.linkedAudioTrackId ? trackId : undefined,
    );
    if (audioTrackResolution.requestedTrackRejected) {
      log.warn('Cannot add requested linked video/audio placement', {
        linkedAudioTrackId: options?.linkedAudioTrackId,
      });
      return undefined;
    }
    set(state => {
      const audioTracks = state.tracks.filter(t => t.type === 'audio' && !t.locked);
      let audioTrackId = audioTrackResolution.trackId;

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

      const { audioClip, videoClip } = createLinkedVideoClipPlaceholders({
        audioClipId: audioId,
        audioTrackId,
        estimatedDuration,
        file,
        initialVisualTransform,
        mediaFileId,
        sourceTranscript,
        startTime,
        videoClipId: clipId,
        videoTrackId: trackId,
      });
      const configuredVideoClip = applyAddClipOptions(videoClip, options);
      const runtimeVideoClip = bindRuntimeToClip(configuredVideoClip, { file, mediaFileId });
      const runtimeAudioClip = bindRuntimeToClip(audioClip, { file, mediaFileId });

      finalAudioClipId = audioId;
      return {
        clips: [...state.clips, runtimeVideoClip, runtimeAudioClip],
        tracks: newTracks,
      };
    });
    updateDuration();

    await loadVideoMedia({
      clipId,
      audioClipId: finalAudioClipId,
      file,
      mediaFileId,
      authoritativeNaturalDuration,
      thumbnailsEnabled,
      waveformsEnabled,
      updateClip,
      setClips,
    });

    invalidateCache();
    queueMediaSourceArtifactProjection(mediaFileId);
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
    queueMediaSourceArtifactProjection(mediaFileId);
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
    const clip = applyAddClipOptions({
      ...createImageClipPlaceholder({ trackId, file, startTime, estimatedDuration, mediaFileId }),
      transform: initialVisualTransform,
    }, options);
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
