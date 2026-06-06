import type {
  RenderResourceDescriptor,
  RuntimeHealthStatus,
  TimelineRuntimeAdmissionDecision,
} from './runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

type ThumbnailJobKind =
  | 'thumbnail-db-load'
  | 'thumbnail-generation'
  | 'thumbnail-bitmap-decode';

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getThumbnailOwner(params: {
  mediaFileId?: string;
  thumbnailUrl?: string;
}) {
  const mediaFileId = params.mediaFileId;
  const thumbnailHash = params.thumbnailUrl ? hashString(params.thumbnailUrl) : undefined;
  return {
    ownerId: mediaFileId ? `thumbnail:${mediaFileId}` : `thumbnail-url:${thumbnailHash ?? 'unknown'}`,
    ownerType: 'thumbnail' as const,
    mediaFileId,
  };
}

function getStatus(status?: RuntimeHealthStatus): RuntimeHealthStatus {
  return status ?? 'unknown';
}

export function getThumbnailDbLoadJobId(mediaFileId: string, fileHash?: string): string {
  return `timeline-thumbnail:db-load:${mediaFileId}:${fileHash ?? 'no-hash'}`;
}

export function getThumbnailGenerationJobId(mediaFileId: string): string {
  return `timeline-thumbnail:generation:${mediaFileId}`;
}

export function getThumbnailGenerationVideoResourceId(mediaFileId: string): string {
  return `timeline-thumbnail:generation-video:${mediaFileId}`;
}

export function getThumbnailGenerationCanvasResourceId(mediaFileId: string): string {
  return `timeline-thumbnail:generation-canvas:${mediaFileId}`;
}

export function getThumbnailBitmapDecodeJobId(url: string): string {
  return `timeline-thumbnail:bitmap-decode:${hashString(url)}`;
}

export function getThumbnailBitmapResourceId(url: string): string {
  return `timeline-thumbnail:bitmap:${hashString(url)}`;
}

export function createThumbnailJobDescriptor(params: {
  jobId: string;
  jobKind: ThumbnailJobKind;
  mediaFileId?: string;
  fileHash?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  status?: RuntimeHealthStatus;
}): RenderResourceDescriptor {
  const status = getStatus(params.status);
  return {
    id: params.jobId,
    kind: 'job',
    policyId: 'thumbnail',
    jobId: params.jobId,
    jobKind: params.jobKind,
    owner: getThumbnailOwner(params),
    source: {
      mediaFileId: params.mediaFileId,
      fileHash: params.fileHash,
      previewPath: params.thumbnailUrl,
      projectPath: params.sourceUrl,
    },
    diagnostics: {
      status,
      messages: [
        {
          severity: status === 'warning' ? 'warning' : 'info',
          code: `thumbnail.${params.jobKind}`,
          message: `${params.jobKind} is retained by the thumbnail runtime policy.`,
          policyId: 'thumbnail',
          resourceId: params.jobId,
        },
      ],
    },
    label: params.jobKind,
    tags: ['thumbnail', params.jobKind],
  };
}

export function canRetainThumbnailJob(params: {
  jobId: string;
  jobKind: ThumbnailJobKind;
  mediaFileId?: string;
  fileHash?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  status?: RuntimeHealthStatus;
}): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createThumbnailJobDescriptor(params));
}

export function reportThumbnailJob(params: {
  jobId: string;
  jobKind: ThumbnailJobKind;
  mediaFileId?: string;
  fileHash?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  status?: RuntimeHealthStatus;
}): void {
  timelineRuntimeCoordinator.retainResource(createThumbnailJobDescriptor(params));
}

export function reportThumbnailGenerationVideo(params: {
  mediaFileId: string;
  sourceUrl: string;
  element: HTMLVideoElement;
}): void {
  timelineRuntimeCoordinator.retainResource(createThumbnailGenerationVideoDescriptor(params));
}

export function createThumbnailGenerationVideoDescriptor(params: {
  mediaFileId: string;
  sourceUrl: string;
  element: HTMLVideoElement;
}): RenderResourceDescriptor {
  const status: RuntimeHealthStatus = params.element.error
    ? 'warning'
    : params.element.readyState >= HTMLMediaElement.HAVE_METADATA
      ? 'ok'
      : 'unknown';
  return {
    id: getThumbnailGenerationVideoResourceId(params.mediaFileId),
    kind: 'html-media',
    policyId: 'thumbnail',
    owner: getThumbnailOwner({ mediaFileId: params.mediaFileId }),
    source: {
      mediaFileId: params.mediaFileId,
      projectPath: params.sourceUrl,
    },
    mediaElementKind: 'video',
    elementId: `thumbnail-generation-video:${params.mediaFileId}`,
    srcKind: params.sourceUrl.startsWith('blob:')
      ? 'blob-url'
      : params.sourceUrl.startsWith('http')
        ? 'remote-url'
        : 'unknown',
    diagnostics: {
      status,
      provider: {
        providerId: `thumbnail-generation-video:${params.mediaFileId}`,
        providerKind: 'html-video',
        status,
        isReady: params.element.readyState >= HTMLMediaElement.HAVE_METADATA,
        isPlaying: !params.element.paused,
        isSeeking: params.element.seeking,
        currentTimeSeconds: params.element.currentTime,
        readyState: params.element.readyState,
        networkState: params.element.networkState,
        errorCode: params.element.error ? String(params.element.error.code) : undefined,
      },
    },
    label: 'Thumbnail generation video',
    tags: ['thumbnail', 'thumbnail-generation', 'detached-video'],
  };
}

export function canRetainThumbnailGenerationVideo(params: {
  mediaFileId: string;
  sourceUrl: string;
  element: HTMLVideoElement;
}): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createThumbnailGenerationVideoDescriptor(params));
}

export function createThumbnailGenerationCanvasDescriptor(mediaFileId: string): RenderResourceDescriptor {
  return {
    id: getThumbnailGenerationCanvasResourceId(mediaFileId),
    kind: 'image-canvas',
    policyId: 'thumbnail',
    owner: getThumbnailOwner({ mediaFileId }),
    source: {
      mediaFileId,
    },
    imageKind: 'html-canvas',
    imageId: `thumbnail-generation-canvas:${mediaFileId}`,
    dimensions: {
      width: 160,
      height: 90,
    },
    diagnostics: {
      status: 'ok',
    },
    label: 'Thumbnail generation canvas',
    tags: ['thumbnail', 'thumbnail-generation', 'canvas'],
  };
}

export function canRetainThumbnailGenerationCanvas(mediaFileId: string): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createThumbnailGenerationCanvasDescriptor(mediaFileId));
}

export function reportThumbnailGenerationCanvas(mediaFileId: string): void {
  timelineRuntimeCoordinator.retainResource(createThumbnailGenerationCanvasDescriptor(mediaFileId));
}

export function reportThumbnailBitmapDecodeJob(url: string, mediaFileId?: string): void {
  reportThumbnailJob({
    jobId: getThumbnailBitmapDecodeJobId(url),
    jobKind: 'thumbnail-bitmap-decode',
    mediaFileId,
    thumbnailUrl: url,
  });
}

export function createThumbnailBitmapResourceDescriptor(
  url: string,
  mediaFileId?: string,
): RenderResourceDescriptor {
  return {
    id: getThumbnailBitmapResourceId(url),
    kind: 'image-canvas',
    policyId: 'thumbnail',
    owner: getThumbnailOwner({ mediaFileId, thumbnailUrl: url }),
    source: {
      mediaFileId,
      previewPath: url,
    },
    imageKind: 'image-bitmap',
    imageId: `thumbnail-bitmap:${hashString(url)}`,
    diagnostics: {
      status: 'ok',
    },
    label: 'Decoded thumbnail bitmap',
    tags: ['thumbnail', 'bitmap-decode', 'image-bitmap'],
  };
}

export function reportThumbnailBitmapResource(url: string, mediaFileId?: string): void {
  const resource = createThumbnailBitmapResourceDescriptor(url, mediaFileId);
  timelineRuntimeCoordinator.retainResource(resource);
}

export function releaseThumbnailRuntimeResource(resourceId: string): void {
  timelineRuntimeCoordinator.releaseResource(resourceId);
}
