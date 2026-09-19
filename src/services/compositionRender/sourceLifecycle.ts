import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { mediaRuntimeRegistry } from '../mediaRuntime/registry';
import { releaseRuntimePlaybackSession } from '../mediaRuntime/runtimePlayback';
import {
  releaseCompositionRenderSourceResource,
  reportCompositionRenderSource,
} from '../timeline/compositionRenderRuntimeReporting';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import type { CompositionClipSourceEntry, CompositionSources } from './sourceTypes';

export function releaseCompositionSourceRuntime(entry: CompositionClipSourceEntry): void {
  if (entry.compositionId) {
    releaseCompositionRenderSourceResource(entry.compositionId, entry.clipId);
  }

  if (!entry.runtimeSourceId) {
    return;
  }

  if (entry.runtimeSessionKey) {
    releaseRuntimePlaybackSession({
      runtimeSourceId: entry.runtimeSourceId,
      runtimeSessionKey: entry.runtimeSessionKey,
    });
  }

  if (!entry.runtimeOwnerId) {
    return;
  }

  mediaRuntimeRegistry.releaseRuntime(entry.runtimeSourceId, entry.runtimeOwnerId);
}

export function reportCompositionSource(
  compositionId: string,
  entry: CompositionClipSourceEntry
): void {
  reportCompositionRenderSource({
    compositionId,
    clipId: entry.clipId,
    type: entry.type,
    videoElement: entry.videoElement,
    imageElement: entry.imageElement,
    textCanvas: entry.textCanvas,
    naturalDuration: entry.naturalDuration,
    runtimeSourceId: entry.runtimeSourceId,
    runtimeSessionKey: entry.runtimeSessionKey,
    mediaFileId: entry.mediaFileId,
  });
}

export function revokeObjectUrl(url: string | undefined): void {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export function revokeObjectUrls(...urls: Array<string | undefined>): void {
  for (const url of new Set(urls.filter((candidate): candidate is string => !!candidate))) {
    revokeObjectUrl(url);
  }
}

export function releaseVideoElement(video: HTMLVideoElement, ownedObjectUrl?: string): void {
  const src = video.currentSrc || video.src;
  video.pause();
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    // Some browsers throw if load() runs during teardown; src removal is enough.
  }
  // An empty src attribute is a new (invalid) media request. Detach first, then
  // revoke owned URLs so no active element can request a revoked blob.
  revokeObjectUrls(ownedObjectUrl, src);
}

export function releaseImageElement(image: HTMLImageElement, ownedObjectUrl?: string): void {
  revokeObjectUrls(ownedObjectUrl);
  image.removeAttribute('src');
  image.src = '';
}

export function disposeCompositionSourceEntry(entry: CompositionClipSourceEntry): void {
  releaseCompositionSourceRuntime(entry);

  if (!entry.compositionId) {
    return;
  }

  if (entry.videoElement) {
    releaseVideoElement(entry.videoElement);
  }

  if (entry.imageElement) {
    releaseImageElement(entry.imageElement, entry.ownedObjectUrl);
  }

  if (entry.lottieClip && isVectorAnimationSourceType(entry.type)) {
    vectorAnimationRuntimeManager.destroyClipRuntime(entry.lottieClip.id, entry.type);
  }
}

export function disposeCompositionSources(
  sources: CompositionSources,
  options: { deleteFromCache?: boolean; cache?: Map<string, CompositionSources> } = {}
): void {
  sources.disposed = true;
  sources.isReady = false;

  for (const disposePendingSource of Array.from(sources.pendingSourceDisposers.values())) {
    disposePendingSource();
  }

  sources.pendingSourceDisposers.clear();

  for (const source of sources.clipSources.values()) {
    disposeCompositionSourceEntry(source);
  }

  sources.clipSources.clear();

  if (options.deleteFromCache) {
    options.cache?.delete(sources.compositionId);
  }
}
