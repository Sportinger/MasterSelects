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
  getMediaStatus,
  getRunOwner,
  getRunResourceId,
  getSrcKind,
  releaseExportResource,
  removeUndefinedValues,
  retainExportResource,
} from './core';
import type {
  ExportFrameProviderAdmissionReport,
  ExportRuntimeBindingAdmissionReport,
} from './types';

function getRuntimeSourceMediaFileId(report: ExportRuntimeBindingAdmissionReport): string | undefined {
  return report.runtimeSource.mediaFileId ?? report.clip.mediaFileId;
}

function getFrameProviderMediaFileId(report: ExportFrameProviderAdmissionReport): string | undefined {
  return report.runtimeSource?.mediaFileId ?? report.clip.mediaFileId;
}

function createExportRuntimeBindingResource(
  report: ExportRuntimeBindingAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getRuntimeSourceMediaFileId(report);
  const resourceId = getRunResourceId(
    report.runId,
    `clip:${report.clip.id}:runtime-binding:${report.runtimeSource.runtimeSourceId}:${report.runtimeSource.runtimeSessionKey}`
  );
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'runtime-binding',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      projectPath: report.runtimeSource.filePath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: report.clip.duration,
    }),
    tags: ['export', 'clip-state', report.runtimeSource.type ?? 'unknown'],
  }), {
    resourceKind: 'runtime-binding',
    runtimeSourceId: report.runtimeSource.runtimeSourceId,
    runtimeSessionKey: report.runtimeSource.runtimeSessionKey,
    label: 'Export runtime binding',
  });
}

export function canRetainExportRuntimeBinding(
  report: ExportRuntimeBindingAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportRuntimeBindingResource(report));
}

export function reserveExportRuntimeBinding(
  report: ExportRuntimeBindingAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportRuntimeBindingResource(report);
  const decision = canRetainExportResource(resource);
  if (decision.admitted) {
    retainExportResource(resource);
  }
  return decision;
}

export function releaseReservedExportRuntimeBinding(
  report: ExportRuntimeBindingAdmissionReport
): void {
  releaseExportResource(getRunResourceId(
    report.runId,
    `clip:${report.clip.id}:runtime-binding:${report.runtimeSource.runtimeSourceId}:${report.runtimeSource.runtimeSessionKey}`
  ));
}

function reportExportRuntimeBinding(runId: string, state: ExportClipState): void {
  const runtimeSource = state.runtimeSource;
  if (!runtimeSource?.runtimeSourceId || !runtimeSource.runtimeSessionKey) {
    return;
  }

  retainExportResource(createExportRuntimeBindingResource({
    runId,
    clip: {
      id: state.clipId,
      mediaFileId: runtimeSource.mediaFileId,
    },
    runtimeSource: {
      type: runtimeSource.type,
      runtimeSourceId: runtimeSource.runtimeSourceId,
      runtimeSessionKey: runtimeSource.runtimeSessionKey,
      mediaFileId: runtimeSource.mediaFileId,
      filePath: runtimeSource.filePath,
    },
  }));
}

function createExportFrameProviderResource(
  report: ExportFrameProviderAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getFrameProviderMediaFileId(report);
  const resourceId = getRunResourceId(report.runId, `clip:${report.clip.id}:frame-provider`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
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
    tags: report.tags ?? ['export', 'clip-state', report.providerKind ?? 'webcodecs'],
  }), {
    resourceKind: 'video-frame-provider',
    providerId: resourceId,
    providerKind: report.providerKind ?? 'webcodecs',
    canSeek: true,
    canProvideStaleFrame: false,
    frameFormat: report.frameFormat ?? 'video-frame',
    runtimeSourceId: report.runtimeSource?.runtimeSourceId,
    runtimeSessionKey: report.runtimeSource?.runtimeSessionKey,
    label: report.label ?? 'Export WebCodecs frame provider',
  });
}

export function canRetainExportFrameProvider(
  report: ExportFrameProviderAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportFrameProviderResource(report));
}

export function reserveExportFrameProvider(
  report: ExportFrameProviderAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportFrameProviderResource(report);
  const decision = canRetainExportResource(resource);
  if (decision.admitted) {
    retainExportResource(resource);
  }
  return decision;
}

export function releaseReservedExportFrameProvider(
  report: ExportFrameProviderAdmissionReport
): void {
  releaseExportResource(getRunResourceId(report.runId, `clip:${report.clip.id}:frame-provider`));
}

function reportExportFrameProvider(runId: string, state: ExportClipState): void {
  const player = state.webCodecsPlayer;
  const runtimeSource = state.runtimeSource;
  if (!player) {
    return;
  }

  const status: RuntimeHealthStatus = player.isFullMode() ? 'ok' : 'warning';
  const resource = createExportFrameProviderResource({
    runId,
    clip: {
      id: state.clipId,
      mediaFileId: runtimeSource?.mediaFileId,
    },
    runtimeSource: runtimeSource?.runtimeSourceId
      ? {
          runtimeSourceId: runtimeSource.runtimeSourceId,
          runtimeSessionKey: runtimeSource.runtimeSessionKey,
          mediaFileId: runtimeSource.mediaFileId,
        }
      : undefined,
  });
  retainExportResource({
    ...resource,
    diagnostics: {
      status,
      provider: {
        providerId: getRunResourceId(runId, `clip:${state.clipId}:frame-provider`),
        providerKind: 'webcodecs',
        status,
        isReady: player.isFullMode(),
        isPlaying: player.isPlaying,
        isSeeking: player.isSeeking?.(),
        isDecodePending: player.isDecodePending?.(),
        currentTimeSeconds: player.currentTime,
        pendingSeekTimeSeconds: player.getPendingSeekTime?.() ?? null,
      },
    },
  });
}

function reportExportPreciseVideo(runId: string, state: ExportClipState): void {
  const video = state.preciseVideoElement;
  if (!video) {
    return;
  }

  const runtimeSource = state.runtimeSource;
  const status = getMediaStatus(video);
  const resourceId = getRunResourceId(runId, `clip:${state.clipId}:html-media:video`);
  const elementId = getRunResourceId(runId, `clip:${state.clipId}:video`);
  retainExportResource(createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'html-media',
    owner: getRunOwner(runId, state.clipId, runtimeSource?.mediaFileId),
    source: removeUndefinedValues({
      sourceId: runtimeSource?.runtimeSourceId,
      mediaFileId: runtimeSource?.mediaFileId,
      clipId: state.clipId,
    }),
    tags: ['export', 'clip-state', 'html-video'],
  }), {
    resourceKind: 'html-media',
    mediaElementKind: 'video',
    elementId,
    srcKind: getSrcKind(video.currentSrc || video.src),
    diagnostics: {
      status,
      provider: {
        providerId: elementId,
        providerKind: 'html-video',
        status,
        isReady: video.readyState >= HTMLMediaElement.HAVE_METADATA,
        isPlaying: !video.paused,
        isSeeking: video.seeking,
        currentTimeSeconds: video.currentTime,
        readyState: video.readyState,
        networkState: video.networkState,
        errorCode: video.error ? String(video.error.code) : undefined,
      },
    },
    label: state.hasDedicatedPreciseVideoElement
      ? 'Export dedicated precise video element'
      : 'Export shared precise video element',
  }));
}

function reportExportImage(runId: string, state: ExportClipState): void {
  const image = state.exportImageElement;
  if (!image) {
    return;
  }

  const runtimeSource = state.runtimeSource;
  const src = image.currentSrc || image.src;
  const status: RuntimeHealthStatus = image.complete || image.naturalWidth > 0 ? 'ok' : 'unknown';
  const resourceId = getRunResourceId(runId, `clip:${state.clipId}:image:html-image`);
  retainExportResource(createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: getRunOwner(runId, state.clipId, runtimeSource?.mediaFileId),
    source: removeUndefinedValues({
      sourceId: runtimeSource?.runtimeSourceId,
      mediaFileId: runtimeSource?.mediaFileId,
      clipId: state.clipId,
      previewPath: src || undefined,
    }),
    tags: ['export', 'clip-state', 'html-image', getSrcKind(src)],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'html-image',
    imageId: getRunResourceId(runId, `clip:${state.clipId}:image`),
    diagnostics: {
      status,
    },
    label: state.hasDedicatedExportImageElement
      ? 'Export dedicated image element'
      : 'Export shared image element',
  }));
}

export function reportExportClipStates(
  runId: string,
  clipStates: ReadonlyMap<string, ExportClipState>
): void {
  const reportedRuntimeBindings = new Set<string>();
  const reportedFrameProviders = new Set<object>();
  const reportedPreciseVideos = new Set<HTMLVideoElement>();
  const reportedImages = new Set<HTMLImageElement>();

  for (const state of clipStates.values()) {
    const runtimeSource = state.runtimeSource;
    const runtimeBindingKey = runtimeSource?.runtimeSourceId && runtimeSource.runtimeSessionKey
      ? `${runtimeSource.runtimeSourceId}:${runtimeSource.runtimeSessionKey}`
      : null;
    if (runtimeBindingKey && !reportedRuntimeBindings.has(runtimeBindingKey)) {
      reportedRuntimeBindings.add(runtimeBindingKey);
      reportExportRuntimeBinding(runId, state);
    }

    if (state.webCodecsPlayer && !reportedFrameProviders.has(state.webCodecsPlayer)) {
      reportedFrameProviders.add(state.webCodecsPlayer);
      reportExportFrameProvider(runId, state);
    }
    if (state.preciseVideoElement && !reportedPreciseVideos.has(state.preciseVideoElement)) {
      reportedPreciseVideos.add(state.preciseVideoElement);
      reportExportPreciseVideo(runId, state);
    }
    if (state.exportImageElement && !reportedImages.has(state.exportImageElement)) {
      reportedImages.add(state.exportImageElement);
      reportExportImage(runId, state);
    }
  }
}
