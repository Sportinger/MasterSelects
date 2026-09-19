import { Logger } from '../logger';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import {
  bindSourceRuntimeForOwner,
  planSourceRuntimeBindingForOwner,
} from '../mediaRuntime/clipBindings';
import { startTimelineImageHydration, type TimelineImageHydrationHandle } from '../timeline/imageRuntimeHydrator';
import { reservePlannedClipRuntimeResources } from '../timeline/runtimeResourceReporting';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import {
  buildSerializableVectorAnimationClip,
  createImageHydrationDemand,
  getRuntimeAdmissionClip,
  getRuntimeOwnerId,
  getTimelineImageSource,
} from './sourceSetup';
import { releaseImageElement, releaseVideoElement, revokeObjectUrls, reportCompositionSource } from './sourceLifecycle';
import type {
  CompositionImageSource,
  CompositionLoadClip,
  CompositionMediaFile,
  CompositionSources,
} from './sourceTypes';

const log = Logger.create('CompositionRenderer');

type SourceCurrentCheck = (sources: CompositionSources) => boolean;

export function prepareNestedTimelineImageSources(
  sources: CompositionSources,
  clips: readonly TimelineClip[],
  mediaFiles: CompositionMediaFile[],
  loadPromises: Promise<void>[],
  isSourcesCurrent: SourceCurrentCheck
): void {
  for (const clip of clips) {
    if (clip.nestedClips?.length) {
      prepareNestedTimelineImageSources(sources, clip.nestedClips, mediaFiles, loadPromises, isSourcesCurrent);
    }

    if (clip.source?.type !== 'image' || clip.source.imageElement) {
      continue;
    }

    const mediaFileId = clip.source.mediaFileId ?? clip.mediaFileId;
    const mediaFile = mediaFileId
      ? mediaFiles.find((file) => file.id === mediaFileId)
      : undefined;
    const imageSource = getTimelineImageSource(clip, mediaFile);
    if (!imageSource) {
      continue;
    }

    loadPromises.push(loadImageSource(
      sources,
      {
        id: clip.id,
        name: clip.name,
        mediaFileId,
        naturalDuration: clip.source.naturalDuration || clip.duration,
      },
      imageSource,
      isSourcesCurrent
    ));
  }
}

export function loadVideoSource(
  sources: CompositionSources,
  clip: SerializableClip,
  file: File,
  isSourcesCurrent: SourceCurrentCheck
): Promise<void> {
  return new Promise((resolve) => {
    const runtimeOwnerId = getRuntimeOwnerId(sources.compositionId, clip.id);
    const plannedSource = {
      type: 'video' as const,
      mediaFileId: clip.mediaFileId,
      naturalDuration: clip.naturalDuration || clip.duration || 0,
    };
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId: runtimeOwnerId,
      sessionOwnerId: runtimeOwnerId,
      sessionPolicy: 'background',
      source: plannedSource,
      file,
      mediaFileId: clip.mediaFileId,
    });
    const admissionClip = getRuntimeAdmissionClip(sources.compositionId, clip);
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'composition-render',
      ownerId: runtimeOwnerId,
      ownerType: 'composition',
      compositionId: sources.compositionId,
      clip: admissionClip,
      source: runtimePlan?.source ?? plannedSource,
      mediaElementKind: 'video',
      srcKind: 'blob-url',
      label: 'Composition render video hydration',
      tags: ['composition-render', 'video'],
    });
    if (!admission.admitted) {
      log.debug('Composition video hydration skipped by runtime admission', {
        compositionId: sources.compositionId,
        clipId: clip.id,
        reason: admission.decision.reason,
        rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
      });
      resolve();
      return;
    }

    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    let cleanedUp = false;
    const pendingKey = `video:${clip.id}`;
    const finish = () => {
      if (!settled) {
        settled = true;
        // Loading listeners belong to this request, not the cached video's lifetime.
        // In particular, cache disposal must not report a new load failure.
        video.removeEventListener('canplaythrough', onCanPlayThrough);
        video.removeEventListener('error', onError);
        if (sources.pendingSourceDisposers.get(pendingKey) === cleanupPendingSource) {
          sources.pendingSourceDisposers.delete(pendingKey);
        }
        resolve();
      }
    };
    const cleanupPendingSource = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      video.removeEventListener('canplaythrough', onCanPlayThrough);
      video.removeEventListener('error', onError);
      admission.release();
      releaseVideoElement(video, objectUrl);
      finish();
    };
    const onCanPlayThrough = () => {
      if (!isSourcesCurrent(sources)) {
        cleanupPendingSource();
        return;
      }

      if (sources.pendingSourceDisposers.get(pendingKey) === cleanupPendingSource) {
        sources.pendingSourceDisposers.delete(pendingKey);
      }

      const runtimeSource = bindSourceRuntimeForOwner({
        ownerId: runtimeOwnerId,
        sessionOwnerId: runtimeOwnerId,
        sessionPolicy: 'background',
        source: {
          type: 'video',
          videoElement: video,
          mediaFileId: clip.mediaFileId,
          naturalDuration: video.duration || clip.naturalDuration || 0,
        },
        file,
        mediaFileId: clip.mediaFileId,
      });
      const entry = {
        clipId: clip.id,
        compositionId: sources.compositionId,
        type: 'video' as const,
        videoElement: video,
        file,
        naturalDuration: video.duration || clip.naturalDuration || 0,
        runtimeSourceId: runtimeSource?.runtimeSourceId,
        runtimeSessionKey: runtimeSource?.runtimeSessionKey,
        runtimeOwnerId,
        mediaFileId: clip.mediaFileId,
      };
      sources.clipSources.set(clip.id, entry);
      reportCompositionSource(sources.compositionId, entry);
      log.debug(`Video loaded: ${file.name}`);
      finish();
    };
    const onError = () => {
      log.error(`Failed to load video: ${file.name}`, {
        mediaErrorCode: video.error?.code ?? null,
        readyState: video.readyState,
        networkState: video.networkState,
        fileSize: file.size,
        mimeType: file.type,
      });
      cleanupPendingSource();
    };

    video.src = objectUrl;
    video.loop = false;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    sources.pendingSourceDisposers.set(pendingKey, cleanupPendingSource);

    video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
    video.addEventListener('error', onError, { once: true });

    video.load();
  });
}

export function loadImageSource(
  sources: CompositionSources,
  clip: CompositionLoadClip,
  imageSource: CompositionImageSource,
  isSourcesCurrent: SourceCurrentCheck
): Promise<void> {
  return new Promise((resolve) => {
    let handle: TimelineImageHydrationHandle | null = null;
    let settled = false;
    let cleanedUp = false;
    const pendingKey = `image:${clip.id}`;
    const finish = () => {
      if (!settled) {
        settled = true;
        if (sources.pendingSourceDisposers.get(pendingKey) === cleanupPendingSource) {
          sources.pendingSourceDisposers.delete(pendingKey);
        }
        resolve();
      }
    };
    const cleanupPendingSource = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      handle?.cancel();
      if (handle?.image) {
        releaseImageElement(handle.image, imageSource.objectUrl);
      } else {
        revokeObjectUrls(imageSource.objectUrl);
      }
      finish();
    };

    sources.pendingSourceDisposers.set(pendingKey, cleanupPendingSource);
    const runtimeOwnerId = getRuntimeOwnerId(sources.compositionId, clip.id);

    handle = startTimelineImageHydration({
      url: imageSource.url,
      resource: {
        demand: createImageHydrationDemand(sources, clip, imageSource, runtimeOwnerId),
        imageId: `${runtimeOwnerId}:image`,
        label: 'Composition render image hydration',
        tags: ['composition-render', 'image'],
      },
      isCurrent: () => isSourcesCurrent(sources),
      onReady: (img) => {
        if (sources.pendingSourceDisposers.get(pendingKey) === cleanupPendingSource) {
          sources.pendingSourceDisposers.delete(pendingKey);
        }

        const runtimeSource = bindSourceRuntimeForOwner({
          ownerId: runtimeOwnerId,
          sessionOwnerId: runtimeOwnerId,
          sessionPolicy: 'background',
          source: {
            type: 'image',
            imageElement: img,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.naturalDuration || 5,
          },
          file: imageSource.file,
          mediaFileId: clip.mediaFileId,
        });
        const entry = {
          clipId: clip.id,
          compositionId: sources.compositionId,
          type: 'image' as const,
          imageElement: img,
          file: imageSource.file,
          naturalDuration: clip.naturalDuration || 5,
          runtimeSourceId: runtimeSource?.runtimeSourceId,
          runtimeSessionKey: runtimeSource?.runtimeSessionKey,
          runtimeOwnerId,
          mediaFileId: clip.mediaFileId,
          ownedObjectUrl: imageSource.objectUrl,
        };
        sources.clipSources.set(clip.id, entry);
        reportCompositionSource(sources.compositionId, entry);
        log.debug(`Image loaded: ${imageSource.name}`);
        finish();
      },
      onError: () => {
        log.error(`Failed to load image: ${imageSource.name}`);
        cleanupPendingSource();
      },
      onStale: (img) => {
        releaseImageElement(img, imageSource.objectUrl);
        finish();
      },
      onAdmissionDenied: (decision) => {
        log.debug('Composition image hydration skipped by runtime admission', {
          compositionId: sources.compositionId,
          clipId: clip.id,
          reason: decision.reason,
          rejectedUnits: decision.rejectedUnits.map((entry) => entry.unit),
        });
        cleanupPendingSource();
      },
    });
  });
}

export async function loadVectorAnimationSource(
  sources: CompositionSources,
  clip: SerializableClip,
  file: File,
  isSourcesCurrent: SourceCurrentCheck
): Promise<void> {
  try {
    const vectorClip = buildSerializableVectorAnimationClip(clip, file);
    const runtimeOwnerId = getRuntimeOwnerId(sources.compositionId, clip.id);
    const runtime = await vectorAnimationRuntimeManager.prepareClipSource(vectorClip, file, {
      policyId: 'composition-render',
      ownerId: runtimeOwnerId,
      ownerType: 'composition',
      compositionId: sources.compositionId,
      resourceId: `composition-render:${sources.compositionId}:${clip.id}:image-canvas:text-canvas`,
      imageId: `${runtimeOwnerId}:text-canvas`,
      label: 'Composition render vector runtime canvas',
      tags: ['composition-render', 'vector-animation', isVectorAnimationSourceType(clip.sourceType) ? clip.sourceType : 'lottie'],
    });

    if (!isSourcesCurrent(sources)) {
      vectorAnimationRuntimeManager.destroyClipRuntime(vectorClip.id, vectorClip.source?.type);
      return;
    }

    vectorClip.source = {
      ...vectorClip.source!,
      textCanvas: runtime.canvas,
      naturalDuration: runtime.metadata.duration ?? clip.naturalDuration ?? clip.duration,
    };

    const entry = {
      clipId: clip.id,
      compositionId: sources.compositionId,
      type: isVectorAnimationSourceType(clip.sourceType) ? clip.sourceType : 'lottie',
      textCanvas: runtime.canvas,
      file,
      lottieClip: vectorClip,
      naturalDuration: runtime.metadata.duration ?? clip.naturalDuration ?? clip.duration,
      mediaFileId: clip.mediaFileId,
    };
    sources.clipSources.set(clip.id, entry);
    reportCompositionSource(sources.compositionId, entry);
  } catch (error) {
    log.error(`Failed to load vector animation: ${file.name}`, error);
  }
}
