import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import {
  planSourceRuntimeBindingForOwner,
  type PlannedSourceRuntimeBinding,
} from '../../../services/mediaRuntime/clipBindings';
import {
  releaseReservedExportParallelDecoder,
  releaseReservedExportParallelFrameBuffer,
  reserveExportParallelDecoder,
  reserveExportParallelFrameBuffer,
  reserveExportRuntimeBinding,
  type ExportClipElementAdmissionReport,
  type ExportFrameProviderAdmissionReport,
  type ExportParallelDecodeAdmissionReport,
  type ExportRuntimeBindingAdmissionReport,
} from '../../../services/timeline/exportRuntimeReporting';
import type { TimelineRuntimeAdmissionDecision } from '../../../services/timeline/runtimeCoordinatorTypes';

export type ExportSrcKind = 'blob-url' | 'remote-url' | 'project-path' | 'unknown';

export function createExportPreparationAdmissionError(
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

export function getClipMediaFileId(clip: TimelineClip): string | undefined {
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

export function createRuntimeBindingPlan(
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

export function createSequentialFrameProviderAdmissionReport(
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

export function createParallelDecodeAdmissionReport(params: {
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

export function reserveParallelDecodeAdmission(
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

export function releaseParallelDecodeAdmission(report: ExportParallelDecodeAdmissionReport): void {
  releaseReservedExportParallelFrameBuffer(report);
  releaseReservedExportParallelDecoder(report);
}

export function reserveExportRuntimeBindingForClip(
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

export function getExportSrcKind(src: string | undefined): ExportSrcKind {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  return 'project-path';
}

export function createClipElementAdmissionReport(
  runId: string,
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  options: {
    previewPath?: string;
    srcKind?: ExportSrcKind;
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
