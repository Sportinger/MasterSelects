import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import {
  releaseReservedExportImageElement,
  releaseReservedExportPreciseVideoElement,
  reserveExportImageElement,
  reserveExportPreciseVideoElement,
} from '../../../services/timeline/exportRuntimeReporting';
import type { ExportClipState } from '../ClipPreparation';
import {
  createClipElementAdmissionReport,
  getClipMediaFileId,
  getExportSrcKind,
} from './admission';
import { resolveClipExportFile } from './sourceResolution';
import { getMappedClipSourceTime } from '../layerBuilder/timing';

const log = Logger.create('ClipPreparation');

function createDetachedExportVideoElement(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.load();
  return video;
}

function createDetachedExportImageElement(src: string): HTMLImageElement {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  return image;
}

function waitForVideoCondition(
  video: HTMLVideoElement,
  events: Array<'loadedmetadata' | 'loadeddata' | 'canplay' | 'canplaythrough' | 'seeked' | 'error'>,
  timeoutMs: number,
  ready: () => boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    if (ready()) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(ready());
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      for (const eventName of events) {
        video.removeEventListener(eventName, onEvent);
      }
    };

    const onEvent = () => {
      if (!ready()) {
        return;
      }
      cleanup();
      resolve(true);
    };

    for (const eventName of events) {
      video.addEventListener(eventName, onEvent);
    }
  });
}

function waitForExportImageLoad(image: HTMLImageElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (image.complete || image.naturalWidth > 0) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(image.complete || image.naturalWidth > 0);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };

    const onLoad = () => {
      cleanup();
      resolve(true);
    };

    const onError = () => {
      cleanup();
      resolve(false);
    };

    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
  });
}

async function primePreciseExportVideoElement(
  video: HTMLVideoElement,
  warmupTime: number
): Promise<void> {
  const metadataReady = await waitForVideoCondition(
    video,
    ['loadedmetadata', 'error'],
    10000,
    () => video.readyState >= 1
  );

  if (!metadataReady) {
    return;
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const maxSeekTime = duration > 0 ? Math.max(0, duration - 0.001) : 0;
  const warmupTarget = duration > 0
    ? Math.max(0, Math.min(warmupTime, maxSeekTime))
    : Math.max(0, warmupTime);

  if (Math.abs(video.currentTime - warmupTarget) > 0.01 || video.readyState < 2) {
    try {
      video.currentTime = warmupTarget;
    } catch {
      // Ignore warmup seek failures - export seeking has its own recovery path.
    }
  }

  await waitForVideoCondition(
    video,
    ['loadeddata', 'canplay', 'canplaythrough', 'seeked', 'error'],
    2500,
    () => !video.seeking && video.readyState >= 2
  );
}

export async function createPreciseExportVideoElement(
  clip: TimelineClip,
  mediaFile?: MediaFile | null,
  warmupTime = 0,
  exportRunId?: string
): Promise<{ videoElement: HTMLVideoElement; objectUrl?: string } | null> {
  const resolvedFile = await resolveClipExportFile(clip, mediaFile);
  const fallbackSrc =
    clip.source?.videoElement?.currentSrc ||
    clip.source?.videoElement?.src ||
    mediaFile?.url ||
    '';

  if (!resolvedFile && !fallbackSrc) {
    return null;
  }

  const admissionReport = exportRunId
    ? createClipElementAdmissionReport(exportRunId, clip, mediaFile, {
        previewPath: resolvedFile ? resolvedFile.name : fallbackSrc,
        srcKind: resolvedFile ? 'blob-url' : getExportSrcKind(fallbackSrc),
        dedicated: true,
      })
    : null;
  if (admissionReport) {
    const admission = reserveExportPreciseVideoElement(admissionReport);
    if (!admission.admitted) {
      log.debug('Export precise video skipped by runtime admission', {
        clipId: clip.id,
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return null;
    }
  }

  const objectUrl = resolvedFile ? URL.createObjectURL(resolvedFile) : undefined;
  const src = objectUrl ?? fallbackSrc;

  const videoElement = createDetachedExportVideoElement(src);

  try {
    await primePreciseExportVideoElement(videoElement, warmupTime);
    if (videoElement.readyState < 1) {
      throw new Error('Export video metadata did not become available');
    }
    return { videoElement, objectUrl };
  } catch (e) {
    videoElement.pause();
    videoElement.removeAttribute('src');
    try {
      videoElement.load();
    } catch {
      // Ignore teardown failures for detached export video elements.
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    if (admissionReport) {
      releaseReservedExportPreciseVideoElement(admissionReport);
    }
    log.warn(`Failed to create dedicated PRECISE export video for ${clip.name}:`, e);
    return null;
  }
}

async function createExportImageElement(
  clip: TimelineClip,
  mediaFile?: MediaFile | null,
  exportRunId?: string
): Promise<{ imageElement: HTMLImageElement; objectUrl?: string; dedicated: boolean } | null> {
  if (clip.source?.imageElement) {
    if (exportRunId) {
      const admissionReport = createClipElementAdmissionReport(exportRunId, clip, mediaFile, {
        previewPath: clip.source.imageElement.currentSrc || clip.source.imageElement.src,
        srcKind: getExportSrcKind(clip.source.imageElement.currentSrc || clip.source.imageElement.src),
        dedicated: false,
      });
      const admission = reserveExportImageElement(admissionReport);
      if (!admission.admitted) {
        log.debug('Export shared image skipped by runtime admission', {
          clipId: clip.id,
          resourceId: admission.resourceId,
          reason: admission.reason,
          rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
        });
        return null;
      }
    }
    return {
      imageElement: clip.source.imageElement,
      dedicated: false,
    };
  }

  const reusableSrc = clip.source?.imageUrl || mediaFile?.url || '';
  const resolvedFile = reusableSrc ? null : await resolveClipExportFile(clip, mediaFile);
  if (!reusableSrc && !resolvedFile) {
    return null;
  }
  const admissionReport = exportRunId
    ? createClipElementAdmissionReport(exportRunId, clip, mediaFile, {
        previewPath: reusableSrc || resolvedFile?.name,
        srcKind: resolvedFile ? 'blob-url' : getExportSrcKind(reusableSrc),
        dedicated: true,
      })
    : null;
  if (admissionReport) {
    const admission = reserveExportImageElement(admissionReport);
    if (!admission.admitted) {
      log.debug('Export image skipped by runtime admission', {
        clipId: clip.id,
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return null;
    }
  }

  const objectUrl = resolvedFile ? URL.createObjectURL(resolvedFile) : undefined;
  const src = reusableSrc || objectUrl || '';

  const imageElement = createDetachedExportImageElement(src);
  const loaded = await waitForExportImageLoad(imageElement, 10000);
  if (!loaded) {
    imageElement.removeAttribute('src');
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    if (admissionReport) {
      releaseReservedExportImageElement(admissionReport);
    }
    log.warn(`Failed to prepare export image for ${clip.name}`);
    return null;
  }

  return {
    imageElement,
    objectUrl,
    dedicated: true,
  };
}

function collectExportImageClips(clips: TimelineClip[], output: TimelineClip[] = []): TimelineClip[] {
  for (const clip of clips) {
    if (clip.source?.type === 'image') {
      output.push(clip);
    }
    if (clip.isComposition && clip.nestedClips?.length) {
      collectExportImageClips(clip.nestedClips, output);
    }
  }
  return output;
}

export async function prepareImageClipsForExport(
  clips: TimelineClip[],
  mediaFiles: MediaFile[],
  clipStates: Map<string, ExportClipState>,
  exportRunId?: string
): Promise<void> {
  const imageClips = collectExportImageClips(clips);
  if (imageClips.length === 0) {
    return;
  }

  await Promise.all(imageClips.map(async (clip) => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const preparedImage = await createExportImageElement(clip, mediaFile, exportRunId);
    if (!preparedImage) {
      return;
    }

    clipStates.set(clip.id, {
      ...(clipStates.get(clip.id) ?? {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
      }),
      exportImageElement: preparedImage.imageElement,
      exportImageObjectUrl: preparedImage.objectUrl ?? null,
      hasDedicatedExportImageElement: preparedImage.dedicated,
    });
  }));
}

export function getClipWarmupSourceTime(clip: TimelineClip, exportStartTime: number): number {
  const firstTimelineTime = Math.max(exportStartTime, clip.startTime);
  const clipLocalTime = Math.max(0, Math.min(clip.duration, firstTimelineTime - clip.startTime));
  const mappedSourceTime = getMappedClipSourceTime(clip, clipLocalTime);
  if (mappedSourceTime !== undefined) return mappedSourceTime;

  const clipSpeed = clip.speed ?? 1;
  const speedAdjusted = clipLocalTime * Math.abs(clipSpeed);
  const sourceTime = (clip.reversed !== (clipSpeed < 0))
    ? clip.outPoint - speedAdjusted
    : clip.inPoint + speedAdjusted;
  const minSourceTime = Math.min(clip.inPoint, clip.outPoint);
  const maxSourceTime = Math.max(clip.inPoint, clip.outPoint);
  const safeMaxSourceTime = Math.max(minSourceTime, maxSourceTime - 0.001);

  return Math.max(minSourceTime, Math.min(sourceTime, safeMaxSourceTime));
}
