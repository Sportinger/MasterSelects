import type {
  RenderResourceDescriptor,
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
import type { ExportAudioBufferReport, ExportPreviewFrameReport } from './types';

function createExportAudioBufferResource(report: ExportAudioBufferReport): RenderResourceDescriptor {
  // Mix and master are consecutive states of the same output slot. Replacing
  // the descriptor avoids counting the same PCM allocation twice when the
  // master bus processes the mix in place, while still updating its stage and
  // memory diagnostics when master effects produce a fresh buffer.
  const resourceKey = report.stage === 'mix-buffer' || report.stage === 'master-buffer'
    ? 'audio:output-buffer:timeline'
    : `audio:${report.stage}:${report.clipId ?? report.trackId ?? 'timeline'}`;
  const audioSourceId = getRunResourceId(
    report.runId,
    resourceKey
  );
  const heapBytes = Math.max(
    0,
    report.buffer.length * report.buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
  );

  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: audioSourceId,
    resourceKind: 'audio-buffer',
    owner: getRunOwner(report.runId, report.clipId, report.mediaFileId),
    source: removeUndefinedValues({
      mediaFileId: report.mediaFileId,
      clipId: report.clipId,
      trackId: report.trackId,
    }),
    dimensions: {
      sampleRate: report.buffer.sampleRate,
      channelCount: report.buffer.numberOfChannels,
      durationSeconds: report.buffer.duration,
    },
    tags: ['export', 'audio', report.stage],
  }), {
    resourceKind: 'audio-buffer',
    audioBufferId: audioSourceId,
    memoryCost: {
      heapBytes,
      decodedFrameBytes: heapBytes,
    },
    diagnostics: {
      status: 'ok',
    },
    label: `Export audio ${report.stage}`,
  });
}

export function canRetainExportAudioBuffer(
  report: ExportAudioBufferReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportAudioBufferResource(report));
}

export function reportExportAudioBuffer(report: ExportAudioBufferReport): void {
  retainExportResource(createExportAudioBufferResource(report));
}

export function releaseExportAudioBuffer(report: ExportAudioBufferReport): void {
  releaseExportResource(createExportAudioBufferResource(report).id);
}

function createExportPreviewFrameResource(report: ExportPreviewFrameReport): RenderResourceDescriptor {
  const resourceId = getRunResourceId(report.runId, 'preview-frame:image-bitmap');
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.width,
      height: report.height,
    },
    source: {
      previewPath: report.currentTime.toFixed(3),
    },
    tags: ['export', 'preview-frame'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'image-bitmap',
    imageId: getRunResourceId(report.runId, 'preview-frame'),
    memoryCost: {
      heapBytes: report.width * report.height * 4,
    },
    label: 'Export preview frame bitmap',
  });
}

export function canRetainExportPreviewFrame(
  report: ExportPreviewFrameReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportPreviewFrameResource(report));
}

export function reportExportPreviewFrame(report: ExportPreviewFrameReport): void {
  retainExportResource(createExportPreviewFrameResource(report));
}
