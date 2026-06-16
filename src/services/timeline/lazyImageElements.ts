import type { TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore/types';
import type { FrameContext } from '../layerBuilder/types';
import { Logger } from '../logger';
import { renderHostPort } from '../render/renderHostPort';
import type { RuntimeProviderDemand } from '../../timeline';
import type { ImageCanvasResourceDescriptor, RenderResourceDescriptor } from './runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

type LazyImageStatus = 'loading' | 'ready' | 'error';
type LazyImageSrcKind = 'blob-url' | 'remote-url' | 'unknown';

export type LazyImageLookupContext = Pick<FrameContext, 'now' | 'mediaFileById' | 'mediaFileByName'> & {
  onImageStatusChange?: (clipId: string) => void;
};

interface PlannedLazyImageSource {
  url?: string;
  file?: File;
  mediaFileId?: string;
  sourceKey: string;
  srcKind: LazyImageSrcKind;
}

interface LazyImageRecord {
  clipId: string;
  trackId: string;
  element: HTMLImageElement;
  mediaFileId?: string;
  objectUrl?: string;
  sourceUrl?: string;
  sourceKey: string;
  srcKind: LazyImageSrcKind;
  status: LazyImageStatus;
  lastDesiredAt: number;
  createdAt: number;
  statusCallbacks: Set<(clipId: string) => void>;
}

const log = Logger.create('LazyImageElements');

const IDLE_RELEASE_MS = 1800;
const MAX_LAZY_IMAGE_ELEMENTS = 64;

const lazyImageRecords = new Map<string, LazyImageRecord>();

function getRecordKey(clipId: string): string {
  return `image:${clipId}`;
}

function getResourceId(record: Pick<LazyImageRecord, 'clipId'>): string {
  return `timeline-lazy-image:${record.clipId}`;
}

function getUsableFile(file: File | undefined): File | undefined {
  return file && (typeof file.size !== 'number' || file.size > 0) ? file : undefined;
}

function getImageSrcKindFromUrl(url: string | undefined): LazyImageSrcKind {
  if (!url) return 'unknown';
  if (url.startsWith('blob:')) return 'blob-url';
  if (url.startsWith('http')) return 'remote-url';
  return 'unknown';
}

function getFileSourceKey(file: File, mediaFileId: string | undefined, clip: TimelineClip): string {
  return [
    'file',
    mediaFileId ?? clip.mediaFileId ?? clip.id,
    file.name,
    file.size,
    file.lastModified,
  ].join(':');
}

function getMediaFileForImageClip(ctx: LazyImageLookupContext, clip: TimelineClip): MediaFile | undefined {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (mediaFileId) {
    const mediaFile = ctx.mediaFileById.get(mediaFileId);
    if (mediaFile) return mediaFile;
  }

  return clip.name ? ctx.mediaFileByName.get(clip.name) : undefined;
}

function getPlannedLazyImageSource(ctx: LazyImageLookupContext, clip: TimelineClip): PlannedLazyImageSource | null {
  const mediaFile = getMediaFileForImageClip(ctx, clip);
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id;

  if (clip.source?.imageUrl) {
    return {
      url: clip.source.imageUrl,
      mediaFileId,
      sourceKey: `clip-image-url:${clip.source.imageUrl}`,
      srcKind: getImageSrcKindFromUrl(clip.source.imageUrl),
    };
  }

  if (mediaFile?.url) {
    return {
      url: mediaFile.url,
      mediaFileId,
      sourceKey: `media-url:${mediaFile.id}:${mediaFile.url}`,
      srcKind: getImageSrcKindFromUrl(mediaFile.url),
    };
  }

  const file = getUsableFile(clip.file) ?? getUsableFile(clip.source?.file) ?? getUsableFile(mediaFile?.file);
  if (file) {
    return {
      file,
      mediaFileId,
      sourceKey: getFileSourceKey(file, mediaFileId, clip),
      srcKind: 'blob-url',
    };
  }

  return null;
}

function materializeLazyImageSource(source: PlannedLazyImageSource): { url: string; objectUrl?: string } | null {
  if (source.url) {
    return { url: source.url };
  }

  if (source.file) {
    const objectUrl = URL.createObjectURL(source.file);
    return { url: objectUrl, objectUrl };
  }

  return null;
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function createLazyImageDemand(params: {
  clipId: string;
  trackId: string;
  mediaFileId?: string;
  sourceUrl?: string;
  srcKind: LazyImageSrcKind;
}): RuntimeProviderDemand {
  return {
    id: `timeline-lazy-image:${params.clipId}`,
    facetId: `lazy-image:${params.clipId}`,
    resourceKind: 'image-canvas',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner: removeUndefinedValues({
      ownerId: params.clipId,
      ownerType: 'clip' as const,
      clipId: params.clipId,
      trackId: params.trackId,
      mediaFileId: params.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: params.mediaFileId,
      clipId: params.clipId,
      trackId: params.trackId,
      mediaFileId: params.mediaFileId,
      previewPath: params.sourceUrl,
    }),
    priority: 'visible',
    tags: ['primary-lazy-image', params.srcKind],
  };
}

function createLazyImageDescriptor(params: {
  clipId: string;
  trackId: string;
  mediaFileId?: string;
  sourceUrl?: string;
  srcKind: LazyImageSrcKind;
  status: LazyImageStatus;
}): RenderResourceDescriptor & ImageCanvasResourceDescriptor {
  return createRenderResourceDescriptorFromDemand(createLazyImageDemand(params), {
    resourceKind: 'image-canvas',
    diagnostics: {
      status: params.status === 'error' ? 'warning' : params.status === 'ready' ? 'ok' : 'unknown',
    },
    imageKind: 'html-image',
    imageId: getRecordKey(params.clipId),
    label: 'Lazy image element',
  }) as RenderResourceDescriptor & ImageCanvasResourceDescriptor;
}

function classifyLazyImage(record: LazyImageRecord): RenderResourceDescriptor & ImageCanvasResourceDescriptor {
  return createLazyImageDescriptor({
    clipId: record.clipId,
    trackId: record.trackId,
    mediaFileId: record.mediaFileId,
    sourceUrl: record.sourceUrl,
    srcKind: record.srcKind,
    status: record.status,
  });
}

function canCreateLazyImageRecord(clip: TimelineClip, plannedSource: PlannedLazyImageSource): boolean {
  const admission = timelineRuntimeCoordinator.canRetainResource(createLazyImageDescriptor({
    clipId: clip.id,
    trackId: clip.trackId,
    mediaFileId: plannedSource.mediaFileId,
    sourceUrl: plannedSource.url,
    srcKind: plannedSource.srcKind,
    status: 'loading',
  }));

  if (!admission.admitted) {
    log.debug('Lazy image element skipped by runtime admission', {
      clipId: clip.id,
      reason: admission.reason,
      rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
    });
  }

  return admission.admitted;
}

function reportLazyImageRecord(record: LazyImageRecord): void {
  timelineRuntimeCoordinator.retainResource(classifyLazyImage(record));
}

function releaseLazyImageRecord(record: Pick<LazyImageRecord, 'clipId'>): void {
  timelineRuntimeCoordinator.releaseResource(getResourceId(record));
}

function registerStatusCallback(record: LazyImageRecord, ctx: LazyImageLookupContext): void {
  if (!ctx.onImageStatusChange || record.status === 'ready') {
    return;
  }

  record.statusCallbacks.add(ctx.onImageStatusChange);
}

function notifyStatusCallbacks(record: LazyImageRecord): void {
  for (const callback of record.statusCallbacks) {
    callback(record.clipId);
  }
  record.statusCallbacks.clear();
}

function detachRecord(record: LazyImageRecord): void {
  releaseLazyImageRecord(record);
  record.element.onload = null;
  record.element.onerror = null;
  record.element.removeAttribute('src');
  record.statusCallbacks.clear();

  if (record.objectUrl) {
    URL.revokeObjectURL(record.objectUrl);
  }
}

function createImageRecord(ctx: LazyImageLookupContext, clip: TimelineClip): LazyImageRecord | null {
  const plannedSource = getPlannedLazyImageSource(ctx, clip);
  if (!plannedSource || !canCreateLazyImageRecord(clip, plannedSource)) return null;

  const source = materializeLazyImageSource(plannedSource);
  if (!source) return null;

  const image = new Image();
  image.crossOrigin = 'anonymous';

  const record: LazyImageRecord = {
    clipId: clip.id,
    trackId: clip.trackId,
    element: image,
    mediaFileId: plannedSource.mediaFileId,
    objectUrl: source.objectUrl,
    sourceUrl: source.url,
    sourceKey: plannedSource.sourceKey,
    srcKind: plannedSource.srcKind,
    status: 'loading',
    lastDesiredAt: ctx.now,
    createdAt: ctx.now,
    statusCallbacks: new Set(),
  };

  image.onload = () => {
    record.status = 'ready';
    reportLazyImageRecord(record);
    notifyStatusCallbacks(record);
    renderHostPort.requestRender();
  };
  image.onerror = () => {
    record.status = 'error';
    reportLazyImageRecord(record);
    notifyStatusCallbacks(record);
    renderHostPort.requestRender();
  };
  image.src = source.url;

  lazyImageRecords.set(getRecordKey(clip.id), record);
  reportLazyImageRecord(record);
  registerStatusCallback(record, ctx);
  return record;
}

function pruneLazyImageRecords(ctx: LazyImageLookupContext): void {
  for (const [key, record] of lazyImageRecords) {
    if (ctx.now - record.lastDesiredAt < IDLE_RELEASE_MS) continue;
    detachRecord(record);
    lazyImageRecords.delete(key);
  }

  if (lazyImageRecords.size <= MAX_LAZY_IMAGE_ELEMENTS) return;

  const releasable = Array.from(lazyImageRecords.entries())
    .sort(([, a], [, b]) => a.lastDesiredAt - b.lastDesiredAt);

  for (const [key, record] of releasable) {
    if (lazyImageRecords.size <= MAX_LAZY_IMAGE_ELEMENTS) break;
    detachRecord(record);
    lazyImageRecords.delete(key);
  }
}

export function getLazyImageElementForClip(ctx: LazyImageLookupContext, clip: TimelineClip): HTMLImageElement | null {
  if (clip.source?.type !== 'image') {
    return null;
  }

  if (clip.source.imageElement) {
    return clip.source.imageElement;
  }

  const key = getRecordKey(clip.id);
  const existing = lazyImageRecords.get(key);
  const plannedSource = getPlannedLazyImageSource(ctx, clip);
  if (existing) {
    if (!plannedSource || existing.sourceKey !== plannedSource.sourceKey) {
      detachRecord(existing);
      lazyImageRecords.delete(key);
    } else {
      existing.lastDesiredAt = ctx.now;
      reportLazyImageRecord(existing);
      registerStatusCallback(existing, ctx);
      return existing.status === 'ready' ? existing.element : null;
    }
  }

  pruneLazyImageRecords(ctx);
  const record = createImageRecord(ctx, clip);
  return record?.status === 'ready' ? record.element : null;
}

export function releaseAllLazyTimelineImageElements(): void {
  for (const record of lazyImageRecords.values()) {
    detachRecord(record);
  }
  lazyImageRecords.clear();
}

export function getLazyTimelineImageElementCount(): number {
  return lazyImageRecords.size;
}
