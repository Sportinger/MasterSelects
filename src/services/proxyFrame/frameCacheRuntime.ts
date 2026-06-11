// Timeline runtime coordinator admission/retain/release for proxy frame cache
// resources. MediaRuntime lease acquire/release call sites intentionally stay
// in proxyFrameCache.ts; this module only talks to the runtime coordinator.

import { Logger } from '../logger';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';
import type { TimelineRuntimeAdmissionDecision } from '../timeline/runtimeCoordinatorTypes';
import type { CachedFrame, CachedVideoFrame } from './frameCacheModels';
import {
  createAudioBufferResource,
  createAudioProxyElementResource,
  createLegacyFrameCacheResource,
  createVideoFrameCacheResource,
  getAudioBufferResourceId,
  getAudioProxyElementResourceId,
  getLegacyFrameCacheStats,
  getLegacyProxyFrameResourceId,
  getVideoFrameCacheStats,
  getVideoFrameResourceId,
} from './runtimeResources';

const log = Logger.create('ProxyFrameCache');

export function logRuntimeAdmissionSkip(
  message: string,
  details: Record<string, unknown>,
  admission: TimelineRuntimeAdmissionDecision,
): void {
  log.debug(message, {
    ...details,
    policyId: admission.policyId,
    reason: admission.reason,
    rejectedUnits: admission.rejectedUnits,
  });
}

// --- Legacy JPEG proxy frame cache resource ---

export function canRetainLegacyFrame(
  cache: ReadonlyMap<string, CachedFrame>,
  mediaFileId: string,
  key: string,
  entry: CachedFrame,
): TimelineRuntimeAdmissionDecision {
  const stats = getLegacyFrameCacheStats(cache, mediaFileId, { key, entry });
  return timelineRuntimeCoordinator.canRetainResource(
    createLegacyFrameCacheResource(mediaFileId, stats)
  );
}

export function refreshLegacyFrameCacheResource(
  cache: ReadonlyMap<string, CachedFrame>,
  mediaFileId: string,
): void {
  const stats = getLegacyFrameCacheStats(cache, mediaFileId);
  if (stats.frameCount === 0) {
    timelineRuntimeCoordinator.releaseResource(getLegacyProxyFrameResourceId(mediaFileId));
    return;
  }
  timelineRuntimeCoordinator.retainResource(createLegacyFrameCacheResource(mediaFileId, stats));
}

export function releaseLegacyFrameCacheResource(mediaFileId: string): void {
  timelineRuntimeCoordinator.releaseResource(getLegacyProxyFrameResourceId(mediaFileId));
}

// --- Proxy WebCodecs VideoFrame cache resource ---

export function canRetainVideoFrame(
  videoFrameCache: ReadonlyMap<string, CachedVideoFrame>,
  mediaFileId: string,
  key: string,
  entry: CachedVideoFrame,
): TimelineRuntimeAdmissionDecision {
  const stats = getVideoFrameCacheStats(videoFrameCache, mediaFileId, { key, entry });
  return timelineRuntimeCoordinator.canRetainResource(
    createVideoFrameCacheResource(mediaFileId, stats)
  );
}

export function refreshVideoFrameCacheResource(
  videoFrameCache: ReadonlyMap<string, CachedVideoFrame>,
  mediaFileId: string,
): void {
  const stats = getVideoFrameCacheStats(videoFrameCache, mediaFileId);
  if (stats.frameCount === 0) {
    timelineRuntimeCoordinator.releaseResource(getVideoFrameResourceId(mediaFileId));
    return;
  }
  timelineRuntimeCoordinator.retainResource(createVideoFrameCacheResource(mediaFileId, stats));
}

export function releaseVideoFrameCacheResource(mediaFileId: string): void {
  timelineRuntimeCoordinator.releaseResource(getVideoFrameResourceId(mediaFileId));
}

// --- Audio proxy element resource ---

export function canRetainAudioProxyElement(
  mediaFileId: string,
  audioSrc: string,
): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(
    createAudioProxyElementResource(mediaFileId, audioSrc)
  );
}

export function reportAudioProxyElement(mediaFileId: string, audio: HTMLAudioElement): void {
  timelineRuntimeCoordinator.retainResource(
    createAudioProxyElementResource(mediaFileId, audio.currentSrc || audio.src, audio)
  );
}

export function releaseAudioProxyElementResource(mediaFileId: string): void {
  timelineRuntimeCoordinator.releaseResource(getAudioProxyElementResourceId(mediaFileId));
}

// --- Decoded scrub/source playback audio buffer resource ---

export function canRetainAudioBufferResource(
  mediaFileId: string,
  buffer: AudioBuffer,
): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(
    createAudioBufferResource(mediaFileId, buffer)
  );
}

export function retainAudioBufferResource(mediaFileId: string, buffer: AudioBuffer): void {
  timelineRuntimeCoordinator.retainResource(createAudioBufferResource(mediaFileId, buffer));
}

export function releaseAudioBufferRuntimeResource(mediaFileId: string): void {
  timelineRuntimeCoordinator.releaseResource(getAudioBufferResourceId(mediaFileId));
}
