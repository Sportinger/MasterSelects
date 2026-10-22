import { audioRoutingManager } from '../audioRoutingManager';
import { Logger } from '../logger';
import { proxyFrameCache } from '../proxyFrameCache';
import { useMediaStore } from '../../stores/mediaStore';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';
import type { RenderResourceDescriptor, TimelineRuntimeAdmissionDecision } from '../timeline/runtimeCoordinatorTypes';
import {
  createAudioProxyInstance,
  hasUsableAudioProxy,
  pauseAudioElement,
} from './audioTrackElementUtils';
import { createActiveAudioProxyResource } from './audioTrackRuntimeResources';
import { AudioTrackProxyLoadTracker, NO_AUDIO_PROXY, type AudioTrackProxyLookup } from './audioTrackProxyLoads';

const log = Logger.create('CutTransition');

type ActiveProxyStore = {
  elements: Map<string, HTMLAudioElement>;
  mediaFileIds: Map<string, string>;
};

type RemoveProxyOptions = {
  shouldPause?: (element: HTMLAudioElement) => boolean;
};

export class AudioTrackRuntimeElementManager {
  private activeVideoAudioProxies = new Map<string, HTMLAudioElement>();
  private activeAudioTrackProxies = new Map<string, HTMLAudioElement>();
  private activeVideoAudioProxyMediaFileIds = new Map<string, string>();
  private activeAudioTrackProxyMediaFileIds = new Map<string, string>();
  private retainedAudioElementResourceIds = new WeakMap<HTMLAudioElement, string>();
  private proxyLoads = new AudioTrackProxyLoadTracker();

  canRetainResource(resource: RenderResourceDescriptor): TimelineRuntimeAdmissionDecision {
    return timelineRuntimeCoordinator.canRetainResource(resource);
  }

  retainResource(resource: RenderResourceDescriptor): void {
    timelineRuntimeCoordinator.retainResource(resource);
  }

  releaseResource(resourceId: string): void {
    timelineRuntimeCoordinator.releaseResource(resourceId);
  }

  retainElementResource(element: HTMLAudioElement, resource: RenderResourceDescriptor): void {
    this.releaseElementResource(element);
    this.retainResource(resource);
    this.retainedAudioElementResourceIds.set(element, resource.id);
  }

  releaseElementResource(element: HTMLAudioElement | null | undefined): void {
    if (!element) return;
    const resourceId = this.retainedAudioElementResourceIds.get(element);
    if (!resourceId) return;
    this.releaseResource(resourceId);
    this.retainedAudioElementResourceIds.delete(element);
  }

  getAudioTrackProxyForClip(mediaFileId: string | undefined, clipId: string): HTMLAudioElement | null {
    return this.resolveAudioTrackProxyForClip(mediaFileId, clipId).element;
  }

  resolveAudioTrackProxyForClip(
    mediaFileId: string | undefined,
    clipId: string,
  ): AudioTrackProxyLookup {
    if (!mediaFileId) return NO_AUDIO_PROXY;
    return this.getAudioProxyInstanceForClip(mediaFileId, clipId, {
      elements: this.activeAudioTrackProxies,
      mediaFileIds: this.activeAudioTrackProxyMediaFileIds,
    });
  }

  getVideoAudioProxyForClip(
    mediaFileId: string,
    clipId: string,
  ): HTMLAudioElement | null {
    return this.getAudioProxyInstanceForClip(mediaFileId, clipId, {
      elements: this.activeVideoAudioProxies,
      mediaFileIds: this.activeVideoAudioProxyMediaFileIds,
    }).element;
  }

  getAudioTrackProxy(clipId: string): HTMLAudioElement | undefined {
    return this.activeAudioTrackProxies.get(clipId);
  }

  pauseAudioTrackProxy(clipId: string): void {
    pauseAudioElement(this.getAudioTrackProxy(clipId));
  }

  removeAudioTrackProxy(clipId: string, options?: RemoveProxyOptions): void {
    this.removeActiveAudioProxy(clipId, {
      elements: this.activeAudioTrackProxies,
      mediaFileIds: this.activeAudioTrackProxyMediaFileIds,
    }, options);
  }

  removeAudioTrackProxiesNotIn(activeClipIds: Set<string>): void {
    for (const clipId of Array.from(this.activeAudioTrackProxies.keys())) {
      if (!activeClipIds.has(clipId)) {
        this.removeAudioTrackProxy(clipId);
      }
    }
  }

  removeVideoAudioProxiesNotIn(activeClipIds: Set<string>): void {
    for (const clipId of Array.from(this.activeVideoAudioProxies.keys())) {
      if (!activeClipIds.has(clipId)) {
        this.removeActiveAudioProxy(clipId, {
          elements: this.activeVideoAudioProxies,
          mediaFileIds: this.activeVideoAudioProxyMediaFileIds,
        });
      }
    }
  }

  pauseAllActiveProxies(): void {
    for (const audioProxy of this.activeAudioTrackProxies.values()) {
      pauseAudioElement(audioProxy);
      audioRoutingManager.removeRoute(audioProxy);
    }
    for (const audioProxy of this.activeVideoAudioProxies.values()) {
      pauseAudioElement(audioProxy);
      audioRoutingManager.removeRoute(audioProxy);
    }
  }

  stopAllActiveProxies(): void {
    for (const clipId of Array.from(this.activeAudioTrackProxies.keys())) {
      this.removeAudioTrackProxy(clipId);
    }
    for (const clipId of Array.from(this.activeVideoAudioProxies.keys())) {
      this.removeActiveAudioProxy(clipId, {
        elements: this.activeVideoAudioProxies,
        mediaFileIds: this.activeVideoAudioProxyMediaFileIds,
      });
    }
  }

  private getAudioProxyInstanceForClip(
    mediaFileId: string,
    clipId: string,
    activeStore: ActiveProxyStore,
  ): AudioTrackProxyLookup {
    const existingMediaFileId = activeStore.mediaFileIds.get(clipId);
    if (existingMediaFileId && existingMediaFileId !== mediaFileId) {
      this.removeActiveAudioProxy(clipId, activeStore);
    }

    const mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFileId);
    if (!hasUsableAudioProxy(mediaFile)) {
      if (activeStore.elements.has(clipId)) {
        this.removeActiveAudioProxy(clipId, activeStore);
      }
      return NO_AUDIO_PROXY;
    }

    const existing = activeStore.elements.get(clipId);
    if (existing && activeStore.mediaFileIds.get(clipId) === mediaFileId && (existing.currentSrc || existing.src)) {
      return { element: existing, pending: false };
    }

    const sharedProxy = proxyFrameCache.getCachedAudioProxy(mediaFileId);
    const src = sharedProxy ? sharedProxy.currentSrc || sharedProxy.src : '';
    if (!sharedProxy || !src) {
      return { element: null, pending: this.proxyLoads.request(mediaFileId) };
    }

    const currentExisting = activeStore.elements.get(clipId);
    if (currentExisting && (currentExisting.currentSrc || currentExisting.src) === src) {
      activeStore.mediaFileIds.set(clipId, mediaFileId);
      return { element: currentExisting, pending: false };
    }

    const resource = createActiveAudioProxyResource({ clipId, mediaFileId, src });
    const admission = this.canRetainResource(resource);
    if (!admission.admitted) {
      log.debug('Skipped active audio proxy clone due to runtime budget', {
        clipId,
        mediaFileId,
        policyId: admission.policyId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits,
      });
      this.proxyLoads.reportFallback(mediaFileId, 'runtime-budget', { clipId, reason: admission.reason });
      if (currentExisting) {
        this.removeActiveAudioProxy(clipId, activeStore);
      }
      return NO_AUDIO_PROXY;
    }

    pauseAudioElement(currentExisting);
    if (currentExisting) {
      // The replaced clone is dropped: dispose its route (removeRoute would keep the graph in the routing map).
      audioRoutingManager.disposeRoute(currentExisting);
      this.releaseElementResource(currentExisting);
    }
    const proxyInstance = createAudioProxyInstance(sharedProxy);
    if (!proxyInstance) {
      this.releaseResource(resource.id);
      return NO_AUDIO_PROXY;
    }
    this.retainElementResource(proxyInstance, resource);
    activeStore.elements.set(clipId, proxyInstance);
    activeStore.mediaFileIds.set(clipId, mediaFileId);
    return { element: proxyInstance, pending: false };
  }

  private removeActiveAudioProxy(
    clipId: string,
    activeStore: ActiveProxyStore,
    options?: RemoveProxyOptions,
  ): void {
    const existing = activeStore.elements.get(clipId);
    const shouldPause = existing ? options?.shouldPause?.(existing) ?? true : true;
    if (shouldPause) {
      pauseAudioElement(existing);
    }
    if (existing) {
      // The clone is dropped; a later request creates a new one, so its route is disposed, not kept.
      audioRoutingManager.disposeRoute(existing);
      this.releaseElementResource(existing);
    }
    activeStore.elements.delete(clipId);
    activeStore.mediaFileIds.delete(clipId);
  }
}
