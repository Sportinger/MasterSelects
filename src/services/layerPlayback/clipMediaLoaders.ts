// clipMediaLoaders - Media element loading for background layer clips.
// Pure moves from LayerPlaybackManager: video/audio/image/vector-animation loaders.
// Handle ownership (pending disposer/hydration maps, element cleanup) stays on the
// manager and is reached through the LayerClipMediaHost callbacks.

import type { TimelineClip } from '../../types';
import { renderHostPort } from '../render/renderHostPort';
import {
  bindSourceRuntimeForOwner,
  planSourceRuntimeBindingForOwner,
} from '../mediaRuntime/clipBindings';
import { reservePlannedClipRuntimeResources } from '../timeline/runtimeResourceReporting';
import {
  startTimelineImageHydration,
  type TimelineImageHydrationHandle,
} from '../timeline/imageRuntimeHydrator';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import type { VectorAnimationProvider } from '../../types/vectorAnimation';
import { Logger } from '../logger';
import { createBackgroundImageDemand, getRuntimeSrcKind } from './runtimeDemand';

const log = Logger.create('LayerPlayback');

export interface LayerClipMediaHost {
  pendingVideoDisposers: Map<string, () => void>;
  pendingImageHydrations: Map<string, TimelineImageHydrationHandle>;
  getRuntimeOwnerId(layerIndex: number, clipId: string): string;
  isClipActive(layerIndex: number, clip: TimelineClip): boolean;
  cleanupVideoElement(video: HTMLVideoElement): void;
  disposePendingVideo(ownerId: string): void;
  reportClipResources(layerIndex: number, clip: TimelineClip): void;
}

export function loadVideoForLayerClip(
  host: LayerClipMediaHost,
  clip: TimelineClip,
  layerIndex: number,
  url: string,
  mediaFileId: string
): void {
  const ownerId = host.getRuntimeOwnerId(layerIndex, clip.id);
  const runtimePlan = planSourceRuntimeBindingForOwner({
    ownerId,
    source: {
      type: 'video',
      mediaFileId,
      naturalDuration: clip.source?.naturalDuration ?? clip.duration,
    },
    mediaFileId,
    sessionPolicy: 'background',
    sessionOwnerId: ownerId,
  });
  const admission = reservePlannedClipRuntimeResources({
    policyId: 'background',
    ownerId,
    ownerType: 'clip',
    clip,
    source: runtimePlan?.source ?? {
      type: 'video',
      mediaFileId,
      naturalDuration: clip.source?.naturalDuration ?? clip.duration,
    },
    mediaElementKind: 'video',
    srcKind: getRuntimeSrcKind(url),
    label: `Background layer ${layerIndex} clip resource`,
    tags: ['background-layer', `layer-${layerIndex}`],
  });
  if (!admission.admitted) {
    clip.isLoading = false;
    log.debug('Background video load skipped by runtime admission', {
      clipId: clip.id,
      layerIndex,
      reason: admission.decision.reason,
      rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
    });
    return;
  }

  host.disposePendingVideo(ownerId);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true; // Background layers muted by default
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  let disposed = false;
  const disposePending = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    video.removeEventListener('canplaythrough', onCanPlayThrough);
    video.removeEventListener('error', onError);
    admission.release();
    host.cleanupVideoElement(video);
    if (host.pendingVideoDisposers.get(ownerId) === disposePending) {
      host.pendingVideoDisposers.delete(ownerId);
    }
  };
  const onCanPlayThrough = () => {
    if (disposed) {
      return;
    }
    if (!host.isClipActive(layerIndex, clip)) {
      disposePending();
      return;
    }
    disposed = true;
    video.removeEventListener('error', onError);
    if (host.pendingVideoDisposers.get(ownerId) === disposePending) {
      host.pendingVideoDisposers.delete(ownerId);
    }
    clip.source = bindSourceRuntimeForOwner({
      ownerId,
      source: {
        type: 'video',
        videoElement: video,
        naturalDuration: video.duration,
        mediaFileId,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    host.reportClipResources(layerIndex, clip);
    clip.isLoading = false;
    log.debug(`Video loaded for background clip ${clip.name} on layer ${layerIndex}`);
    // Pre-cache frame via createImageBitmap for immediate scrubbing without play()
    renderHostPort.preCacheVideoFrame(video);
  };

  const onError = () => {
    disposePending();
    clip.isLoading = false;
    log.warn(`Failed to load video for background clip ${clip.name}`);
  };

  host.pendingVideoDisposers.set(ownerId, disposePending);
  video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
  video.addEventListener('error', onError, { once: true });
}

export function loadAudioForLayerClip(
  host: LayerClipMediaHost,
  clip: TimelineClip,
  layerIndex: number,
  url: string,
  mediaFileId: string
): void {
  const ownerId = host.getRuntimeOwnerId(layerIndex, clip.id);
  const runtimePlan = planSourceRuntimeBindingForOwner({
    ownerId,
    source: {
      type: 'audio',
      mediaFileId,
      naturalDuration: clip.source?.naturalDuration ?? clip.duration,
    },
    mediaFileId,
    sessionPolicy: 'background',
    sessionOwnerId: ownerId,
  });
  const admission = reservePlannedClipRuntimeResources({
    policyId: 'background',
    ownerId,
    ownerType: 'clip',
    clip,
    source: runtimePlan?.source ?? {
      type: 'audio',
      mediaFileId,
      naturalDuration: clip.source?.naturalDuration ?? clip.duration,
    },
    mediaElementKind: 'audio',
    srcKind: getRuntimeSrcKind(url),
    label: `Background layer ${layerIndex} clip resource`,
    tags: ['background-layer', `layer-${layerIndex}`],
  });
  if (!admission.admitted) {
    clip.isLoading = false;
    log.debug('Background audio load skipped by runtime admission', {
      clipId: clip.id,
      layerIndex,
      reason: admission.decision.reason,
      rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
    });
    return;
  }

  const audio = document.createElement('audio');
  audio.src = url;
  audio.preload = 'auto';

  audio.addEventListener('canplaythrough', () => {
    if (!host.isClipActive(layerIndex, clip)) {
      admission.release();
      audio.pause();
      audio.src = '';
      audio.load();
      return;
    }
    clip.source = bindSourceRuntimeForOwner({
      ownerId,
      source: {
        type: 'audio',
        audioElement: audio,
        naturalDuration: audio.duration,
        mediaFileId,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    host.reportClipResources(layerIndex, clip);
    clip.isLoading = false;
    log.debug(`Audio loaded for background clip ${clip.name} on layer ${layerIndex}`);
  }, { once: true });

  audio.addEventListener('error', () => {
    admission.release();
    clip.isLoading = false;
    log.warn(`Failed to load audio for background clip ${clip.name}`);
  }, { once: true });
}

export function loadImageForLayerClip(
  host: LayerClipMediaHost,
  clip: TimelineClip,
  layerIndex: number,
  url: string
): void {
  const ownerId = host.getRuntimeOwnerId(layerIndex, clip.id);
  host.pendingImageHydrations.get(ownerId)?.cancel();
  const handle = startTimelineImageHydration({
    url,
    resource: {
      demand: createBackgroundImageDemand(layerIndex, clip, ownerId, url),
      imageId: `${ownerId}:image`,
      label: 'Background image hydration',
      tags: ['background', 'image'],
    },
    isCurrent: () => host.isClipActive(layerIndex, clip),
    onReady: (img) => {
      host.pendingImageHydrations.delete(ownerId);
      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'image',
          imageElement: img,
          mediaFileId: clip.mediaFileId,
          naturalDuration: clip.duration,
        },
        mediaFileId: clip.mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      host.reportClipResources(layerIndex, clip);
      clip.isLoading = false;
      log.debug(`Image loaded for background clip ${clip.name} on layer ${layerIndex}`);
    },
    onError: () => {
      host.pendingImageHydrations.delete(ownerId);
      clip.isLoading = false;
      log.warn(`Failed to load image for background clip ${clip.name}`);
    },
    onStale: () => {
      host.pendingImageHydrations.delete(ownerId);
      clip.isLoading = false;
    },
    onAdmissionDenied: (decision) => {
      host.pendingImageHydrations.delete(ownerId);
      clip.isLoading = false;
      log.debug('Background image hydration skipped by runtime admission', {
        clipId: clip.id,
        layerIndex,
        reason: decision.reason,
        rejectedUnits: decision.rejectedUnits.map((entry) => entry.unit),
      });
    },
  });
  if (!handle.admitted) {
    return;
  }
  host.pendingImageHydrations.set(ownerId, handle);
}

export function loadVectorAnimationForLayerClip(
  host: LayerClipMediaHost,
  clip: TimelineClip,
  layerIndex: number,
  file: File,
  sourceType: VectorAnimationProvider
): void {
  void (async () => {
    try {
      if (clip.source?.type !== sourceType) {
        clip.source = {
          type: sourceType,
          mediaFileId: clip.mediaFileId,
          naturalDuration: clip.duration,
        };
      }
      const runtimeOwnerId = host.getRuntimeOwnerId(layerIndex, clip.id);
      const runtime = await vectorAnimationRuntimeManager.prepareClipSource(clip, file, {
        policyId: 'background',
        ownerId: runtimeOwnerId,
        ownerType: 'clip',
        label: `Background layer ${layerIndex} vector runtime canvas`,
        tags: ['background-layer', `layer-${layerIndex}`, 'vector-animation'],
      });
      const naturalDuration =
        runtime.metadata.duration ??
        clip.source?.naturalDuration ??
        clip.duration;
      clip.file = file;
      clip.source = {
        type: sourceType,
        textCanvas: runtime.canvas,
        mediaFileId: clip.mediaFileId,
        naturalDuration,
        vectorAnimationSettings: clip.source?.vectorAnimationSettings,
      };
      host.reportClipResources(layerIndex, clip);
      clip.isLoading = false;
      vectorAnimationRuntimeManager.renderClipAtTime(clip, clip.startTime);
    } catch (error) {
      clip.isLoading = false;
      log.warn(`Failed to load vector animation for background clip ${clip.name}`, error);
    }
  })();
}
