import type { RenderResourceDescriptor } from './runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

export interface CompositionRenderSourceResource {
  compositionId: string;
  clipId: string;
  type: string;
  videoElement?: HTMLVideoElement;
  imageElement?: HTMLImageElement;
  textCanvas?: HTMLCanvasElement;
  naturalDuration?: number;
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  mediaFileId?: string;
}

function getCompositionSourceOwnerId(compositionId: string, clipId: string): string {
  return `composition:${compositionId}:clip:${clipId}`;
}

function getResourceId(
  entry: Pick<CompositionRenderSourceResource, 'compositionId' | 'clipId'>,
  suffix: string
): string {
  return `composition-render:${entry.compositionId}:${entry.clipId}:${suffix}`;
}

function getMediaStatus(element: HTMLMediaElement): 'ok' | 'warning' | 'unknown' {
  if (element.error) return 'warning';
  return element.readyState >= HTMLMediaElement.HAVE_METADATA ? 'ok' : 'unknown';
}

function getSrcKind(
  src: string | undefined
): 'blob-url' | 'remote-url' | 'project-path' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  return 'project-path';
}

function getBaseDescriptor(entry: CompositionRenderSourceResource) {
  const ownerId = getCompositionSourceOwnerId(entry.compositionId, entry.clipId);
  return {
    policyId: 'composition-render' as const,
    owner: {
      ownerId,
      ownerType: 'composition' as const,
      clipId: entry.clipId,
      compositionId: entry.compositionId,
      mediaFileId: entry.mediaFileId,
    },
    source: {
      sourceId: entry.runtimeSourceId,
      mediaFileId: entry.mediaFileId,
      clipId: entry.clipId,
      compositionId: entry.compositionId,
    },
    runtime: entry.runtimeSourceId && entry.runtimeSessionKey
      ? {
          runtimeSourceId: entry.runtimeSourceId,
          runtimeSessionKey: entry.runtimeSessionKey,
        }
      : undefined,
    dimensions: {
      durationSeconds: entry.naturalDuration,
    },
    tags: ['composition-render', entry.type],
  };
}

function reportResource(resource: RenderResourceDescriptor): void {
  timelineRuntimeCoordinator.retainResource(resource);
}

export function reportCompositionRenderSource(entry: CompositionRenderSourceResource): void {
  releaseCompositionRenderSourceResource(entry.compositionId, entry.clipId);

  const base = getBaseDescriptor(entry);
  const ownerId = getCompositionSourceOwnerId(entry.compositionId, entry.clipId);

  if (entry.runtimeSourceId && entry.runtimeSessionKey) {
    reportResource({
      ...base,
      id: getResourceId(entry, `runtime-binding:${entry.runtimeSourceId}:${entry.runtimeSessionKey}`),
      kind: 'runtime-binding',
      runtime: {
        runtimeSourceId: entry.runtimeSourceId,
        runtimeSessionKey: entry.runtimeSessionKey,
      },
      label: 'Composition render runtime binding',
    });
  }

  if (entry.videoElement) {
    const element = entry.videoElement;
    const src = element.currentSrc || element.src;
    const status = getMediaStatus(element);
    reportResource({
      ...base,
      id: getResourceId(entry, 'html-media:video'),
      kind: 'html-media',
      mediaElementKind: 'video',
      elementId: `${ownerId}:video`,
      srcKind: getSrcKind(src),
      diagnostics: {
        status,
        provider: {
          providerId: `${ownerId}:video`,
          providerKind: 'html-video',
          status,
          isReady: element.readyState >= HTMLMediaElement.HAVE_METADATA,
          isPlaying: !element.paused,
          isSeeking: element.seeking,
          currentTimeSeconds: element.currentTime,
          readyState: element.readyState,
          networkState: element.networkState,
          errorCode: element.error ? String(element.error.code) : undefined,
        },
      },
      label: 'Composition render video element',
    });
  }

  if (entry.imageElement) {
    reportResource({
      ...base,
      id: getResourceId(entry, 'image-canvas:image'),
      kind: 'image-canvas',
      imageKind: 'html-image',
      imageId: `${ownerId}:image`,
      label: 'Composition render image element',
    });
  }

  if (entry.textCanvas) {
    reportResource({
      ...base,
      id: getResourceId(entry, 'image-canvas:text-canvas'),
      kind: 'image-canvas',
      imageKind: 'html-canvas',
      imageId: `${ownerId}:text-canvas`,
      label: 'Composition render text canvas',
    });
  }
}

export function releaseCompositionRenderSourceResource(
  compositionId: string,
  clipId: string
): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: getCompositionSourceOwnerId(compositionId, clipId),
    policyId: 'composition-render',
  });
}
