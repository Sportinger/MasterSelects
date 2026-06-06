// Clip preparation and initialization for export

import { Logger } from '../../services/logger';
import type { TimelineClip } from '../../stores/timeline/types';
import type { ExportSettings, ExportClipState, ExportMode } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { fileSystemService } from '../../services/fileSystemService';
import { projectFileService } from '../../services/projectFileService';
import {
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from '../../services/project/mediaSourceResolver';
import {
  bindSourceRuntimeForOwner,
  planSourceRuntimeBindingForOwner,
  type PlannedSourceRuntimeBinding,
} from '../../services/mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from '../../services/mediaRuntime/registry';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import type { WebCodecsPlayer } from '../WebCodecsPlayer';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import type { MediaFile } from '../../stores/mediaStore/types';
import {
  releaseReservedExportImageElement,
  releaseReservedExportParallelDecoder,
  releaseReservedExportParallelFrameBuffer,
  releaseReservedExportFrameProvider,
  releaseReservedExportRuntimeBinding,
  releaseReservedExportPreciseVideoElement,
  getExportRunOwnerId,
  reserveExportImageElement,
  reserveExportFrameProvider,
  reserveExportParallelDecoder,
  reserveExportParallelFrameBuffer,
  reserveExportRuntimeBinding,
  reserveExportPreciseVideoElement,
  type ExportClipElementAdmissionReport,
  type ExportFrameProviderAdmissionReport,
  type ExportParallelDecodeAdmissionReport,
  type ExportRuntimeBindingAdmissionReport,
} from '../../services/timeline/exportRuntimeReporting';
import type { TimelineRuntimeAdmissionDecision } from '../../services/timeline/runtimeCoordinatorTypes';

const log = Logger.create('ClipPreparation');
const FAST_EXPORT_SINGLE_FILE_LIMIT_BYTES = 1536 * 1024 * 1024; // 1.5 GB
const FAST_EXPORT_TOTAL_FILE_LIMIT_BYTES = 2048 * 1024 * 1024; // 2 GB

export interface ClipPreparationResult {
  clipStates: Map<string, ExportClipState>;
  parallelDecoder: ParallelDecodeManager | null;
  useParallelDecode: boolean;
  exportMode: ExportMode;
}

type ParallelClipInfo = Parameters<ParallelDecodeManager['initialize']>[0][number];
type ClipFileDataCache = Map<string, Promise<ArrayBuffer | null>>;

function getExportRuntimeOwnerId(clipId: string): string {
  return `export:${clipId}`;
}

function createExportPreparationAdmissionError(
  stage: string,
  clip: Pick<TimelineClip, 'id' | 'name'>,
  decision: TimelineRuntimeAdmissionDecision
): Error {
  const rejected = decision.rejectedUnits
    .map((unit) => `${unit.unit} ${unit.used}/${unit.limit ?? 'unlimited'}`)
    .join(', ');
  const suffix = rejected ? ` (${rejected})` : '';
  const error = new Error(
    `Export preparation refused ${stage} for "${clip.name}" (${clip.id}): ${decision.reason ?? 'not admitted'}${suffix}`
  );
  error.name = 'ExportPreparationAdmissionError';
  return error;
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.mediaFileId || clip.source?.mediaFileId;
}

function getClipAdmissionIdentity(clip: TimelineClip): {
  id: string;
  trackId?: string;
  mediaFileId?: string;
  duration?: number;
} {
  return {
    id: clip.id,
    trackId: clip.trackId,
    mediaFileId: getClipMediaFileId(clip),
    duration: clip.duration,
  };
}

function createRuntimeBindingPlan(
  clip: TimelineClip,
  runtimeOwnerId: string
): PlannedSourceRuntimeBinding | null {
  return planSourceRuntimeBindingForOwner({
    ownerId: runtimeOwnerId,
    source: clip.source,
    file: clip.file,
    mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
    filePath: clip.source?.filePath,
    sessionPolicy: 'export',
    sessionOwnerId: runtimeOwnerId,
  });
}

function createRuntimeBindingAdmissionReport(
  runId: string,
  clip: TimelineClip,
  plan: PlannedSourceRuntimeBinding
): ExportRuntimeBindingAdmissionReport {
  return {
    runId,
    clip: getClipAdmissionIdentity(clip),
    runtimeSource: {
      type: plan.source?.type,
      runtimeSourceId: plan.runtimeSourceId,
      runtimeSessionKey: plan.runtimeSessionKey,
      mediaFileId: plan.mediaFileId,
      filePath: plan.source?.filePath,
    },
  };
}

function createSequentialFrameProviderAdmissionReport(
  runId: string,
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  runtimePlan: PlannedSourceRuntimeBinding | null
): ExportFrameProviderAdmissionReport {
  return {
    runId,
    clip: getClipAdmissionIdentity(clip),
    runtimeSource: runtimePlan
      ? {
          runtimeSourceId: runtimePlan.runtimeSourceId,
          runtimeSessionKey: runtimePlan.runtimeSessionKey,
          mediaFileId: runtimePlan.mediaFileId,
        }
      : undefined,
    width: mediaFile?.width,
    height: mediaFile?.height,
    providerKind: 'webcodecs',
    frameFormat: 'video-frame',
    label: 'Export WebCodecs frame provider',
    tags: ['export', 'clip-state', 'webcodecs', 'sequential'],
  };
}

function estimateParallelFrameBufferBytes(
  mediaFile: MediaFile | null | undefined,
  fps: number
): number | undefined {
  if (!mediaFile?.width || !mediaFile.height) {
    return undefined;
  }
  const plannedBufferedFrames = Math.min(60, Math.max(1, Math.ceil(fps || 30)));
  return mediaFile.width * mediaFile.height * 4 * plannedBufferedFrames;
}

function createParallelDecodeAdmissionReport(params: {
  runId: string;
  clip: TimelineClip;
  mediaFile: MediaFile | null | undefined;
  fps: number;
  isNested?: boolean;
}): ExportParallelDecodeAdmissionReport {
  const mediaFileId = getClipMediaFileId(params.clip);
  return {
    runId: params.runId,
    clip: {
      ...getClipAdmissionIdentity(params.clip),
      mediaFileId,
    },
    codec: params.mediaFile?.codec,
    width: params.mediaFile?.width,
    height: params.mediaFile?.height,
    isNested: params.isNested,
    estimatedBufferedFrameBytes: estimateParallelFrameBufferBytes(params.mediaFile, params.fps),
  };
}

function reserveParallelDecodeAdmission(
  report: ExportParallelDecodeAdmissionReport,
  clip: TimelineClip
): void {
  const decoderDecision = reserveExportParallelDecoder(report);
  if (!decoderDecision.admitted) {
    throw createExportPreparationAdmissionError('parallel decoder', clip, decoderDecision);
  }

  const frameBufferDecision = reserveExportParallelFrameBuffer(report);
  if (!frameBufferDecision.admitted) {
    releaseReservedExportParallelDecoder(report);
    throw createExportPreparationAdmissionError('parallel decoded frame buffer', clip, frameBufferDecision);
  }
}

function releaseParallelDecodeAdmission(report: ExportParallelDecodeAdmissionReport): void {
  releaseReservedExportParallelFrameBuffer(report);
  releaseReservedExportParallelDecoder(report);
}

function reserveExportRuntimeBindingForClip(
  runId: string | undefined,
  clip: TimelineClip,
  runtimePlan: PlannedSourceRuntimeBinding | null
): ExportRuntimeBindingAdmissionReport | null {
  if (!runId || !runtimePlan) {
    return null;
  }

  const report = createRuntimeBindingAdmissionReport(runId, clip, runtimePlan);
  const decision = reserveExportRuntimeBinding(report);
  if (!decision.admitted) {
    throw createExportPreparationAdmissionError('runtime binding', clip, decision);
  }
  return report;
}

function getClipSourceCacheKey(clip: TimelineClip, mediaFile?: MediaFile | null): string {
  const mediaFileId = getClipMediaFileId(clip);
  if (mediaFileId) {
    return `media:${mediaFileId}`;
  }

  const filePath = mediaFile?.filePath || mediaFile?.projectPath || clip.source?.filePath;
  if (filePath) {
    return `path:${filePath}`;
  }

  const url = mediaFile?.url || clip.source?.videoElement?.currentSrc || clip.source?.videoElement?.src;
  if (url) {
    return `url:${url}`;
  }

  if (clip.file) {
    return `file:${clip.file.name}:${clip.file.size}:${clip.file.lastModified}`;
  }

  return `clip:${clip.id}`;
}

function getFastModeFileSizeStats(
  videoClips: TimelineClip[],
  mediaFiles: MediaFile[]
): { totalBytes: number; largestBytes: number; largestClipName: string | null; uniqueSourceCount: number } {
  let totalBytes = 0;
  let largestBytes = 0;
  let largestClipName: string | null = null;
  const countedSources = new Set<string>();

  for (const clip of videoClips) {
    if (clip.source?.type !== 'video') {
      continue;
    }

    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const sourceKey = getClipSourceCacheKey(clip, mediaFile);
    const fileSize = mediaFile?.fileSize ?? clip.file?.size ?? 0;

    if (!countedSources.has(sourceKey)) {
      countedSources.add(sourceKey);
      totalBytes += fileSize;
    }

    if (fileSize > largestBytes) {
      largestBytes = fileSize;
      largestClipName = clip.name;
    }
  }

  return { totalBytes, largestBytes, largestClipName, uniqueSourceCount: countedSources.size };
}

function shouldAutoFallbackToPrecise(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);

  return (
    message.includes('FAST export failed') ||
    message.includes('NotReadableError') ||
    message.includes('The requested file could not be read') ||
    message.includes('Array buffer allocation failed') ||
    message.includes('out of memory')
  );
}

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

function getExportSrcKind(
  src: string | undefined
): 'blob-url' | 'remote-url' | 'project-path' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  return 'project-path';
}

function createClipElementAdmissionReport(
  runId: string,
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  options: {
    previewPath?: string;
    srcKind?: 'blob-url' | 'remote-url' | 'project-path' | 'unknown';
    dedicated?: boolean;
  } = {}
): ExportClipElementAdmissionReport {
  return {
    runId,
    clip: {
      id: clip.id,
      trackId: clip.trackId,
      mediaFileId: getClipMediaFileId(clip),
      duration: clip.duration,
    },
    mediaFileId: mediaFile?.id ?? getClipMediaFileId(clip),
    previewPath: options.previewPath,
    srcKind: options.srcKind,
    dedicated: options.dedicated,
  };
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

async function resolveClipExportFile(clip: TimelineClip, mediaFile?: MediaFile | null): Promise<File | null> {
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId || '';
  const projectHandle = await getStoredProjectFileHandle(mediaFileId);
  if (projectHandle) {
    try {
      return await projectHandle.getFile();
    } catch (e) {
      log.warn(`Project RAW handle failed for ${clip.name}:`, e);
    }
  }

  if (projectFileService.isProjectOpen()) {
    for (const candidatePath of getProjectRawPathCandidates({
      mediaFileId,
      projectPath: mediaFile?.projectPath,
      filePath: mediaFile?.filePath,
      name: clip.name,
    })) {
      try {
        const result = await projectFileService.getFileFromRaw(candidatePath);
        if (result) {
          return result.file;
        }
      } catch (e) {
        log.warn(`Project RAW file load failed for ${clip.name} at ${candidatePath}:`, e);
      }
    }
  }

  const storedHandle = mediaFile?.hasFileHandle && mediaFileId
    ? fileSystemService.getFileHandle(mediaFileId)
    : null;
  if (storedHandle) {
    try {
      return await storedHandle.getFile();
    } catch (e) {
      log.warn(`Media file handle failed for ${clip.name}:`, e);
    }
  }

  if (mediaFile?.file) {
    return mediaFile.file;
  }

  if (clip.file) {
    return clip.file;
  }

  return null;
}

async function createPreciseExportVideoElement(
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

async function prepareImageClipsForExport(
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

function getClipWarmupSourceTime(clip: TimelineClip, exportStartTime: number): number {
  const firstTimelineTime = Math.max(exportStartTime, clip.startTime);
  const clipLocalTime = Math.max(0, Math.min(clip.duration, firstTimelineTime - clip.startTime));
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

function createExportRuntimeSource(
  clip: TimelineClip,
  runtimeOwnerId: string,
  overridePlayer?: WebCodecsPlayer | null,
  exportRunId?: string
): TimelineClip['source'] {
  const runtimePlan = createRuntimeBindingPlan(clip, runtimeOwnerId);
  const admissionReport = reserveExportRuntimeBindingForClip(exportRunId, clip, runtimePlan);
  const runtimeSource = bindSourceRuntimeForOwner({
    ownerId: runtimeOwnerId,
    source: clip.source,
    file: clip.file,
    mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
    filePath: clip.source?.filePath,
    sessionPolicy: 'export',
    sessionOwnerId: runtimeOwnerId,
  });

  if (!runtimeSource) {
    if (admissionReport) {
      releaseReservedExportRuntimeBinding(admissionReport);
    }
    return clip.source;
  }

  if (!runtimeSource.runtimeSourceId || !runtimeSource.runtimeSessionKey) {
    if (admissionReport) {
      releaseReservedExportRuntimeBinding(admissionReport);
    }
    return clip.source;
  }

  return {
    ...runtimeSource,
    webCodecsPlayer: overridePlayer ?? undefined,
  };
}

async function loadClipFileDataCached(
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  cache: ClipFileDataCache
): Promise<ArrayBuffer | null> {
  const sourceKey = getClipSourceCacheKey(clip, mediaFile);
  let promise = cache.get(sourceKey);
  if (!promise) {
    promise = loadClipFileData(clip, mediaFile);
    cache.set(sourceKey, promise);
  }
  return promise;
}

/**
 * Prepare all video clips for export based on export mode.
 * FAST mode: WebCodecs with MP4Box parsing - strict decoder path, no HTML fallback
 * PRECISE mode: explicit HTMLVideoElement seeking - frame-accurate but slower
 */
export async function prepareClipsForExport(
  settings: ExportSettings,
  exportMode: ExportMode,
  exportRunId?: string
): Promise<ClipPreparationResult> {
  const endPrepare = log.time('prepareClipsForExport TOTAL');
  const { clips, tracks } = useTimelineStore.getState();
  const mediaFiles = useMediaStore.getState().files;
  const startTime = settings.startTime;
  const endTime = settings.endTime;

  const clipStates = new Map<string, ExportClipState>();

  // Find all video clips that will be in the export range
  const videoClips = clips.filter(clip => {
    const track = tracks.find(t => t.id === clip.trackId);
    if (!track?.visible || track.type !== 'video') return false;
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime < endTime && clipEnd > startTime;
  });

  const vectorAnimationClips: TimelineClip[] = [];
  for (const clip of videoClips) {
    if (isVectorAnimationSourceType(clip.source?.type)) {
      vectorAnimationClips.push(clip);
    }
    if (clip.isComposition && clip.nestedClips?.length) {
      for (const nestedClip of clip.nestedClips) {
        if (isVectorAnimationSourceType(nestedClip.source?.type)) {
          vectorAnimationClips.push(nestedClip);
        }
      }
    }
  }

  if (vectorAnimationClips.length > 0) {
    await Promise.all(vectorAnimationClips.map(async (clip) => {
      if (!clip.file) {
        return;
      }
      await vectorAnimationRuntimeManager.prepareClipSource(
        clip,
        clip.file,
        exportRunId
          ? {
              policyId: 'export',
              ownerId: getExportRunOwnerId(exportRunId),
              ownerType: 'export',
              resourceId: `export:${exportRunId}:clip:${clip.id}:vector-canvas`,
              imageId: `export:${exportRunId}:clip:${clip.id}:vector-canvas`,
              label: 'Export vector runtime canvas',
              tags: ['export', 'clip-state', 'vector-animation', clip.source?.type ?? 'vector'],
            }
          : undefined,
      );
    }));
  }

  await prepareImageClipsForExport(videoClips, mediaFiles, clipStates, exportRunId);

  log.info(`Preparing ${videoClips.length} video clips for ${exportMode.toUpperCase()} export...`);

  if (exportMode === 'precise') {
    const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime, exportRunId);
    endPrepare();
    return result;
  }

  const { totalBytes, largestBytes, largestClipName, uniqueSourceCount } = getFastModeFileSizeStats(videoClips, mediaFiles);
  if (largestBytes >= FAST_EXPORT_SINGLE_FILE_LIMIT_BYTES || totalBytes >= FAST_EXPORT_TOTAL_FILE_LIMIT_BYTES) {
    endPrepare();
    throw new Error(
      `FAST export refused large source media (largest=${(largestBytes / 1024 / 1024).toFixed(0)}MB, uniqueTotal=${(totalBytes / 1024 / 1024).toFixed(0)}MB, uniqueSources=${uniqueSourceCount}/${videoClips.length}, largestClip="${largestClipName ?? 'unknown'}"). Select HTMLVideo Precise explicitly if this export should use HTMLVideo decoding.`
    );
  }

  // FAST MODE: WebCodecs with MP4Box parsing
  try {
    return await initializeFastMode(
      videoClips,
      mediaFiles,
      startTime,
      endTime,
      clipStates,
      settings.fps,
      exportRunId,
      endPrepare
    );
  } catch (e) {
    if (shouldAutoFallbackToPrecise(e)) {
      log.error('FAST export failed; strict export will not auto-switch to PRECISE mode', e);
    }
    cleanupExportMode(clipStates, null);
    endPrepare();
    throw e;
  }
}

async function initializePreciseMode(
  videoClips: TimelineClip[],
  clipStates: Map<string, ExportClipState>,
  mediaFiles: MediaFile[],
  exportStartTime: number,
  exportRunId?: string
): Promise<ClipPreparationResult> {
  const registerPreciseClip = async (clip: TimelineClip, warmupTime: number) => {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const runtimeSource = createExportRuntimeSource(clip, runtimeOwnerId, null, exportRunId);
    const preparedVideo = clip.source?.type === 'video'
      ? await createPreciseExportVideoElement(clip, mediaFile, warmupTime, exportRunId)
      : null;

    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource,
      preciseVideoElement: preparedVideo?.videoElement ?? clip.source?.videoElement ?? null,
      preciseVideoObjectUrl: preparedVideo?.objectUrl ?? null,
      hasDedicatedPreciseVideoElement: !!preparedVideo,
    });

    return !!preparedVideo;
  };

  let preciseClipCount = 0;
  let preciseNestedClipCount = 0;
  let dedicatedPreciseVideoCount = 0;

  for (const clip of videoClips) {
    if (clip.isComposition && clip.nestedClips) {
      for (const nestedClip of clip.nestedClips) {
        if (nestedClip.source?.type !== 'video') continue;
        if (await registerPreciseClip(nestedClip, getClipWarmupSourceTime(nestedClip, nestedClip.startTime))) {
          dedicatedPreciseVideoCount += 1;
        }
        preciseNestedClipCount += 1;
      }
    }

    if (clip.source?.type !== 'video') continue;
    if (await registerPreciseClip(clip, getClipWarmupSourceTime(clip, exportStartTime))) {
      dedicatedPreciseVideoCount += 1;
    }
    preciseClipCount += 1;
    log.debug(`Clip ${clip.name}: PRECISE mode (HTMLVideoElement seeking)`);
  }
  log.info(`All ${preciseClipCount} clips using PRECISE HTMLVideoElement seeking`);
  if (preciseNestedClipCount > 0) {
    log.info(`Registered ${preciseNestedClipCount} nested PRECISE export clips`);
  }
  if (dedicatedPreciseVideoCount > 0) {
    log.info(`Prepared ${dedicatedPreciseVideoCount} dedicated PRECISE export video elements`);
  }

  return {
    clipStates,
    parallelDecoder: null,
    useParallelDecode: false,
    exportMode: 'precise',
  };
}

async function initializeFastMode(
  videoClips: TimelineClip[],
  mediaFiles: MediaFile[],
  startTime: number,
  endTime: number,
  clipStates: Map<string, ExportClipState>,
  fps: number,
  exportRunId: string | undefined,
  endPrepare: () => void
): Promise<ClipPreparationResult> {
  const { WebCodecsPlayer } = await import('../WebCodecsPlayer');
  const fileDataCache: ClipFileDataCache = new Map();
  const initializeSequentialClip = async (clip: TimelineClip): Promise<void> => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    const runtimePlan = createRuntimeBindingPlan(clip, runtimeOwnerId);
    const providerAdmissionReport = exportRunId
      ? createSequentialFrameProviderAdmissionReport(exportRunId, clip, mediaFile, runtimePlan)
      : null;
    if (providerAdmissionReport) {
      const providerDecision = reserveExportFrameProvider(providerAdmissionReport);
      if (!providerDecision.admitted) {
        throw createExportPreparationAdmissionError('FAST WebCodecs frame provider', clip, providerDecision);
      }
    }

    let exportPlayer: WebCodecsPlayer | null = null;
    try {
      const endLoad = log.time(`loadClipFileData "${clip.name}"`);
      const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);
      endLoad();

      if (!fileData) {
        throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}". Try PRECISE mode instead.`);
      }

      // Detect file format from magic bytes
      const header = new Uint8Array(fileData.slice(0, 12));
      const isMOV = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 &&
                    (header[8] === 0x71 && header[9] === 0x74);
      const fileType = isMOV ? 'MOV' : 'MP4';

      log.debug(`Loaded ${clip.name} (${(fileData.byteLength / 1024 / 1024).toFixed(1)}MB, ${fileType})`);

      // Create dedicated WebCodecs player for export
      exportPlayer = new WebCodecsPlayer({ useSimpleMode: false, loop: false });

      const endParse = log.time(`loadArrayBuffer "${clip.name}"`);
      try {
        await exportPlayer.loadArrayBuffer(fileData);
        endParse();
      } catch (e) {
        endParse();
        const hint = isMOV ? ' MOV containers may have unsupported audio codecs.' : '';
        throw new Error(`FAST export failed: WebCodecs/MP4Box parsing failed for clip "${clip.name}": ${e}.${hint} Try PRECISE mode instead.`);
      }

      // Calculate clip start time (accounting for speed)
      const clipStartInExport = Math.max(0, startTime - clip.startTime);
      const clipSpeed = clip.speed ?? 1;
      const speedAdjusted = clipStartInExport * Math.abs(clipSpeed);
      const clipTime = (clip.reversed !== (clipSpeed < 0))
        ? clip.outPoint - speedAdjusted
        : clip.inPoint + speedAdjusted;

      const endSeqPrep = log.time(`prepareForSequentialExport "${clip.name}"`);
      await exportPlayer.prepareForSequentialExport(clipTime);
      endSeqPrep();

      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: exportPlayer,
        lastSampleIndex: exportPlayer.getCurrentSampleIndex(),
        isSequential: true,
        runtimeOwnerId,
        runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, exportPlayer, exportRunId),
      });

      log.debug(`Clip ${clip.name}: FAST mode enabled (${exportPlayer.width}x${exportPlayer.height})`);
    } catch (e) {
      if (!clipStates.has(clip.id) && providerAdmissionReport) {
        releaseReservedExportFrameProvider(providerAdmissionReport);
      }
      if (!clipStates.has(clip.id) && exportPlayer) {
        try {
          exportPlayer.destroy();
        } catch {
          // Ignore cleanup errors for a failed export-preparation player.
        }
      }
      throw e;
    }
  };

  // Separate composition clips from regular video clips
  const regularVideoClips: TimelineClip[] = [];
  const nestedVideoClips: Array<{ clip: TimelineClip; parentClip: TimelineClip }> = [];

  for (const clip of videoClips) {
    if (clip.source?.type !== 'video') continue;

    if (clip.isComposition) {
      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
      });
      log.debug(`Clip ${clip.name}: Composition with nested clips`);

      // Collect nested video clips
      if (clip.nestedClips) {
        for (const nestedClip of clip.nestedClips) {
          if (nestedClip.source?.type === 'video' && nestedClip.source.videoElement) {
            nestedVideoClips.push({ clip: nestedClip, parentClip: clip });
          }
        }
      }
    } else {
      regularVideoClips.push(clip);
    }
  }

  // Use parallel decoding if we have 2+ total video clips
  const totalVideoClips = regularVideoClips.length + nestedVideoClips.length;
  if (totalVideoClips >= 2) {
    if (nestedVideoClips.length === 0) {
      log.info(`Using multi-clip sequential WebCodecs export for ${regularVideoClips.length} regular video clips`);
      for (const clip of regularVideoClips) {
        await initializeSequentialClip(clip);
      }

      log.info(`All ${regularVideoClips.length} clips using FAST WebCodecs sequential decoding`);
      endPrepare();

      return {
        clipStates,
        parallelDecoder: null,
        useParallelDecode: false,
        exportMode: 'fast',
      };
    }

    log.info(`Using PARALLEL decoding for ${regularVideoClips.length} regular + ${nestedVideoClips.length} nested = ${totalVideoClips} video clips`);
    return initializeParallelDecoding(
      regularVideoClips,
      mediaFiles,
      startTime,
      endTime,
      nestedVideoClips,
      clipStates,
      fps,
      exportRunId,
      endPrepare,
      fileDataCache
    );
  }

  // Single clip: use sequential approach
  for (const clip of regularVideoClips) {
    await initializeSequentialClip(clip);
  }

  log.info(`All ${videoClips.length} clips using FAST WebCodecs sequential decoding`);
  endPrepare();

  return {
    clipStates,
    parallelDecoder: null,
    useParallelDecode: false,
    exportMode: 'fast',
  };
}

async function initializeParallelDecoding(
  clips: TimelineClip[],
  mediaFiles: MediaFile[],
  _startTime: number,
  endTime: number,
  nestedClips: Array<{ clip: TimelineClip; parentClip: TimelineClip }>,
  clipStates: Map<string, ExportClipState>,
  fps: number,
  exportRunId: string | undefined,
  endPrepare: () => void,
  fileDataCache: ClipFileDataCache
): Promise<ClipPreparationResult> {
  const reservedParallelReports: ExportParallelDecodeAdmissionReport[] = [];
  if (exportRunId) {
    try {
      for (const clip of clips) {
        const mediaFileId = getClipMediaFileId(clip);
        const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
        const report = createParallelDecodeAdmissionReport({
          runId: exportRunId,
          clip,
          mediaFile,
          fps,
        });
        reserveParallelDecodeAdmission(report, clip);
        reservedParallelReports.push(report);
      }

      for (const { clip } of nestedClips) {
        const mediaFileId = getClipMediaFileId(clip);
        const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
        const report = createParallelDecodeAdmissionReport({
          runId: exportRunId,
          clip,
          mediaFile,
          fps,
          isNested: true,
        });
        reserveParallelDecodeAdmission(report, clip);
        reservedParallelReports.push(report);
      }
    } catch (e) {
      for (const report of reservedParallelReports) {
        releaseParallelDecodeAdmission(report);
      }
      throw e;
    }
  }

  const parallelDecoder = new ParallelDecodeManager();

  try {
  // Load all clip file data in parallel
  const endLoadAll = log.time('loadAllClipFileData');
  const loadPromises: Promise<ParallelClipInfo>[] = clips.map(async (clip) => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);

    if (!fileData) {
      throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}". Try PRECISE mode instead.`);
    }

    return {
      clipId: clip.id,
      clipName: clip.name,
      fileData,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      reversed: clip.reversed || false,
      speed: clip.speed ?? 1,
    };
  });

  // Load nested clips
  const nestedLoadPromises: Promise<ParallelClipInfo | null>[] = nestedClips.map(async ({ clip, parentClip }) => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);

    if (!fileData) {
      throw new Error(`FAST export failed: Could not load file data for nested clip "${clip.name}". Select HTMLVideo Precise explicitly if this export should use HTMLVideo decoding.`);
    }

    return {
      clipId: clip.id,
      clipName: `${parentClip.name}/${clip.name}`,
      fileData,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      reversed: clip.reversed || false,
      speed: clip.speed ?? 1,
      isNested: true,
      parentClipId: parentClip.id,
      parentStartTime: parentClip.startTime,
      parentInPoint: parentClip.inPoint || 0,
    };
  });

  const loadedClips = await Promise.all(loadPromises);
  const loadedNestedClips = (await Promise.all(nestedLoadPromises)).filter(
    (clipInfo): clipInfo is ParallelClipInfo => clipInfo !== null
  );
  endLoadAll();

  const clipInfos: ParallelClipInfo[] = [...loadedClips, ...loadedNestedClips];

  log.info(`Loaded ${loadedClips.length} regular + ${loadedNestedClips.length} nested clips for parallel decoding`);

  const endParallelInit = log.time('parallelDecoder.initialize');
  await parallelDecoder.initialize(clipInfos, fps);
  endParallelInit();

  // Pre-decode first frame to ensure it's ready when export starts
  // This is critical because the parallel decoder initializes lazily
  const endPrefetch = log.time('parallelDecoder.prefetchFirstFrame');
  await parallelDecoder.prefetchFramesForTime(_startTime);

  // Verify first frame is decoded for clips that are active at start time
  // NOTE: We initialize ALL clips in parallel decoder, but only verify frames for clips active at start
  const MAX_RETRIES = 5;
  for (const clipInfo of clipInfos) {
    // Check if clip is active at start time
    let clipActiveAtStart: boolean;
    let clipTimeAtExportStart: number;

    if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
      // Nested clip: check if parent comp is active and clip is active within it
      const compTime = _startTime - clipInfo.parentStartTime - (clipInfo.parentInPoint || 0);
      clipActiveAtStart = compTime >= clipInfo.startTime && compTime < clipInfo.startTime + clipInfo.duration;
      clipTimeAtExportStart = _startTime; // Use main timeline time for getFrameForClip
    } else {
      // Regular clip
      clipActiveAtStart = _startTime >= clipInfo.startTime && _startTime < clipInfo.startTime + clipInfo.duration;
      clipTimeAtExportStart = _startTime;
    }

    log.debug(`Clip "${clipInfo.clipName}": startTime=${clipInfo.startTime}, exportStart=${_startTime}, active=${clipActiveAtStart}`);

    // Skip verification for clips not active at start, but they ARE initialized in parallel decoder
    if (!clipActiveAtStart) {
      log.debug(`"${clipInfo.clipName}" not active at export start, skipping first frame verification`);
      continue;
    }

    log.info(`Verifying first frame for "${clipInfo.clipName}"`);

    let frame = parallelDecoder.getFrameForClip(clipInfo.clipId, clipTimeAtExportStart);

    if (!frame) {
      // Retry with delays
      for (let retry = 0; retry < MAX_RETRIES && !frame; retry++) {
        log.warn(`First frame not ready for "${clipInfo.clipName}" (attempt ${retry + 1}/${MAX_RETRIES}), retrying...`);
        await new Promise(r => setTimeout(r, 200)); // Give decoder time
        await parallelDecoder.prefetchFramesForTime(clipTimeAtExportStart);
        frame = parallelDecoder.getFrameForClip(clipInfo.clipId, clipTimeAtExportStart);
      }
    }

    if (!frame) {
      throw new Error(`Failed to decode first frame for clip "${clipInfo.clipName}" after ${MAX_RETRIES} attempts. The video file may be corrupted or use an unsupported codec.`);
    }
  }

  const prewarmedClipStarts = await parallelDecoder.prewarmClipStarts(_startTime, endTime);
  if (prewarmedClipStarts > 0) {
    log.info(`Prewarmed ${prewarmedClipStarts} clip start frames for smoother cuts`);
  }
  endPrefetch();

  // Mark clips as using parallel decoding
  for (const clip of clips) {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, null, exportRunId),
    });
  }

  for (const { clip } of nestedClips) {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, null, exportRunId),
    });
  }

  log.info(`Parallel decoding initialized for ${clipInfos.length} total clips`);
  endPrepare();

  return {
    clipStates,
    parallelDecoder,
    useParallelDecode: true,
    exportMode: 'fast',
  };
  } catch (e) {
    for (const report of reservedParallelReports) {
      releaseParallelDecodeAdmission(report);
    }
    parallelDecoder.cleanup();
    throw e;
  }
}

/**
 * Load file data for a clip from various sources.
 */
export async function loadClipFileData(clip: TimelineClip, mediaFile?: MediaFile | null): Promise<ArrayBuffer | null> {
  let fileData: ArrayBuffer | null = null;

  const resolvedFile = await resolveClipExportFile(clip, mediaFile);
  if (!fileData && resolvedFile) {
    try {
      fileData = await resolvedFile.arrayBuffer();
    } catch (e) {
      log.warn(`Resolved export file access failed for ${clip.name}:`, e);
    }
  }

  // 2. Try media file's blob URL
  if (!fileData && mediaFile?.url) {
    try {
      const response = await fetch(mediaFile.url);
      fileData = await response.arrayBuffer();
    } catch (e) {
      log.warn(`Media blob URL fetch failed for ${clip.name}:`, e);
    }
  }

  // 3. Try video element's src (blob URL)
  if (!fileData && clip.source?.videoElement?.src) {
    try {
      const response = await fetch(clip.source.videoElement.src);
      fileData = await response.arrayBuffer();
    } catch (e) {
      log.warn(`Video src fetch failed for ${clip.name}:`, e);
    }
  }

  return fileData;
}

/**
 * Cleanup export mode - destroy dedicated export players.
 */
export function cleanupExportMode(
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null
): void {
  // Cleanup parallel decoder
  if (parallelDecoder) {
    parallelDecoder.cleanup();
  }

  // Destroy all dedicated export WebCodecs players
  for (const state of clipStates.values()) {
    if (state.runtimeSource?.runtimeSourceId && state.runtimeSource.runtimeSessionKey) {
      mediaRuntimeRegistry.releaseSession(
        state.runtimeSource.runtimeSourceId,
        state.runtimeSource.runtimeSessionKey
      );
    }
    if (state.runtimeSource?.runtimeSourceId && state.runtimeOwnerId) {
      mediaRuntimeRegistry.releaseRuntime(
        state.runtimeSource.runtimeSourceId,
        state.runtimeOwnerId
      );
    }
    if (state.webCodecsPlayer && state.isSequential) {
      try {
        state.webCodecsPlayer.endSequentialExport();
        state.webCodecsPlayer.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (state.hasDedicatedPreciseVideoElement && state.preciseVideoElement) {
      try {
        state.preciseVideoElement.pause();
        state.preciseVideoElement.removeAttribute('src');
        state.preciseVideoElement.load();
      } catch {
        // Ignore cleanup failures for detached export video elements.
      }
    }
    if (state.preciseVideoObjectUrl) {
      try {
        URL.revokeObjectURL(state.preciseVideoObjectUrl);
      } catch {
        // Ignore URL cleanup failures.
      }
    }
    if (state.hasDedicatedExportImageElement && state.exportImageElement) {
      try {
        state.exportImageElement.onload = null;
        state.exportImageElement.onerror = null;
        state.exportImageElement.removeAttribute('src');
      } catch {
        // Ignore cleanup failures for detached export image elements.
      }
    }
    if (state.exportImageObjectUrl) {
      try {
        URL.revokeObjectURL(state.exportImageObjectUrl);
      } catch {
        // Ignore URL cleanup failures.
      }
    }
  }

  clipStates.clear();
  log.info('Export cleanup complete');
}
