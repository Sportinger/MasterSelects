import type {
  ParallelDecodeClipRuntimeSnapshot,
  ParallelDecodeRuntimeSnapshot,
} from '../../../engine/ParallelDecodeManager';
import type { ExportClipState } from '../../../engine/export/types';
import type {
  RenderResourceDescriptor,
  RuntimeHealthStatus,
  TimelineRuntimeAdmissionDecision,
} from '../runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from '../runtimeProviderDemandBridge';
import {
  canRetainExportResource,
  createExportDemand,
  getRunOwner,
  getRunResourceId,
  releaseExportResource,
  removeUndefinedValues,
  retainExportResource,
} from './core';
import type { ExportParallelDecodeAdmissionReport } from './types';

function getParallelDecodeMediaFileId(
  report: ExportParallelDecodeAdmissionReport
): string | undefined {
  return report.runtimeSource?.mediaFileId ?? report.clip.mediaFileId;
}

function getParallelDecodeStatus(
  snapshot: ParallelDecodeRuntimeSnapshot,
  clip: ParallelDecodeClipRuntimeSnapshot
): RuntimeHealthStatus {
  if (
    !snapshot.isActive ||
    clip.decoderState === 'closed' ||
    clip.decoderState === 'dormant'
  ) return 'disposed';
  if (clip.decoderState !== 'configured') return 'warning';
  return 'ok';
}

function getExportClipSource(
  clipStates: ReadonlyMap<string, ExportClipState> | undefined,
  clipId: string
): ExportClipState['runtimeSource'] | undefined {
  return clipStates?.get(clipId)?.runtimeSource;
}

function getParallelDecodeTags(
  report: ExportParallelDecodeAdmissionReport,
  hardwareAcceleration?: string
): string[] {
  return [
    'export',
    'parallel-decode',
    report.isNested ? 'nested-clip' : 'timeline-clip',
    hardwareAcceleration ?? 'hardware-unknown',
  ];
}

function createExportParallelDecoderResource(
  report: ExportParallelDecodeAdmissionReport,
  status: RuntimeHealthStatus = 'unknown',
  hardwareAcceleration?: string
): RenderResourceDescriptor {
  const mediaFileId = getParallelDecodeMediaFileId(report);
  const decoderId = getRunResourceId(report.runId, `parallel:${report.clip.id}:decoder`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: decoderId,
    resourceKind: 'native-decoder',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource?.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
    }),
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
      durationSeconds: report.clip.duration,
    }),
    tags: getParallelDecodeTags(report, hardwareAcceleration),
  }), {
    resourceKind: 'native-decoder',
    decoderId,
    codec: report.codec,
    container: 'mp4',
    diagnostics: {
      status,
    },
    label: 'Export parallel VideoDecoder',
  });
}

function createExportParallelFrameBufferResource(
  report: ExportParallelDecodeAdmissionReport,
  status: RuntimeHealthStatus = 'unknown',
  hardwareAcceleration?: string
): RenderResourceDescriptor {
  const mediaFileId = getParallelDecodeMediaFileId(report);
  const providerId = getRunResourceId(report.runId, `parallel:${report.clip.id}:frame-buffer`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: providerId,
    resourceKind: 'video-frame-provider',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource?.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
    }),
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
      durationSeconds: report.clip.duration,
    }),
    tags: [...getParallelDecodeTags(report, hardwareAcceleration), 'decoded-frame-buffer'],
  }), {
    resourceKind: 'video-frame-provider',
    providerId,
    providerKind: 'webcodecs',
    canSeek: true,
    canProvideStaleFrame: false,
    frameFormat: 'video-frame',
    memoryCost: removeUndefinedValues({
      heapBytes: report.estimatedBufferedFrameBytes,
      decodedFrameBytes: report.estimatedBufferedFrameBytes,
    }),
    diagnostics: {
      status,
    },
    label: 'Export parallel decoded VideoFrame buffer',
  });
}

export function canRetainExportParallelDecoder(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportParallelDecoderResource(report));
}

export function reserveExportParallelDecoder(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportParallelDecoderResource(report);
  const decision = canRetainExportResource(resource);
  if (decision.admitted) {
    retainExportResource(resource);
  }
  return decision;
}

export function releaseReservedExportParallelDecoder(
  report: ExportParallelDecodeAdmissionReport
): void {
  releaseExportResource(getRunResourceId(report.runId, `parallel:${report.clip.id}:decoder`));
}

export function canRetainExportParallelFrameBuffer(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportParallelFrameBufferResource(report));
}

export function reserveExportParallelFrameBuffer(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportParallelFrameBufferResource(report);
  const decision = canRetainExportResource(resource);
  if (decision.admitted) {
    retainExportResource(resource);
  }
  return decision;
}

export function releaseReservedExportParallelFrameBuffer(
  report: ExportParallelDecodeAdmissionReport
): void {
  releaseExportResource(getRunResourceId(report.runId, `parallel:${report.clip.id}:frame-buffer`));
}

export function reportExportParallelDecodeResources(
  runId: string,
  snapshot: ParallelDecodeRuntimeSnapshot,
  clipStates?: ReadonlyMap<string, ExportClipState>
): void {
  const reportedClipIds = new Set<string>();
  for (const clip of snapshot.clips) {
    reportedClipIds.add(clip.clipId);
    const runtimeSource = getExportClipSource(clipStates, clip.clipId);
    const status = getParallelDecodeStatus(snapshot, clip);
    const report: ExportParallelDecodeAdmissionReport = {
      runId,
      clip: {
        id: clip.clipId,
        mediaFileId: runtimeSource?.mediaFileId,
      },
      runtimeSource: runtimeSource?.runtimeSourceId
        ? {
            runtimeSourceId: runtimeSource.runtimeSourceId,
            runtimeSessionKey: runtimeSource.runtimeSessionKey,
            mediaFileId: runtimeSource.mediaFileId,
          }
        : undefined,
      codec: clip.codec,
      width: clip.dimensions.width,
      height: clip.dimensions.height,
      isNested: clip.isNested,
      estimatedBufferedFrameBytes: clip.estimatedBufferedFrameBytes,
    };
    const decoderId = getRunResourceId(runId, `parallel:${clip.clipId}:decoder`);
    const providerId = getRunResourceId(runId, `parallel:${clip.clipId}:frame-buffer`);
    const decoderResource = createExportParallelDecoderResource(
      report,
      status,
      clip.hardwareAcceleration
    );
    const frameBufferResource = createExportParallelFrameBufferResource(
      report,
      status,
      clip.hardwareAcceleration
    );

    if (clip.decoderState === 'dormant' || clip.decoderState === 'closed') {
      releaseExportResource(decoderId);
    } else {
      retainExportResource({
        ...decoderResource,
        diagnostics: {
          status,
          provider: {
            providerId: decoderId,
            providerKind: 'native-decoder',
            status,
            isReady: clip.decoderState === 'configured',
            isDecodePending: clip.hasPendingDecode || clip.isDecoding || clip.decodeQueueSize > 0,
            isDisposed: !snapshot.isActive,
            decodeQueueDepth: clip.decodeQueueSize,
            bufferedFrameCount: clip.frameBufferSize,
            currentTimeSeconds: clip.lastDecodedTimeSeconds,
            errorCode: clip.decoderState === 'configured' ? undefined : clip.decoderState,
          },
        },
      });
    }

    if (clip.frameBufferSize === 0) {
      releaseExportResource(providerId);
    } else {
      retainExportResource({
        ...frameBufferResource,
        diagnostics: {
          status,
          provider: {
            providerId,
            providerKind: 'webcodecs',
            status,
            isReady: true,
            isDecodePending: clip.hasPendingDecode || clip.isDecoding || clip.decodeQueueSize > 0,
            isDisposed: !snapshot.isActive,
            currentTimeSeconds: clip.lastDecodedTimeSeconds,
            lastFrameTimeSeconds: clip.newestBufferedTimeSeconds,
            decodeQueueDepth: clip.decodeQueueSize,
            bufferedFrameCount: clip.frameBufferSize,
          },
        },
      });
    }
  }

  for (const clipId of snapshot.registeredClipIds ?? []) {
    if (reportedClipIds.has(clipId)) continue;
    releaseExportResource(getRunResourceId(runId, `parallel:${clipId}:decoder`));
    releaseExportResource(getRunResourceId(runId, `parallel:${clipId}:frame-buffer`));
  }
}
