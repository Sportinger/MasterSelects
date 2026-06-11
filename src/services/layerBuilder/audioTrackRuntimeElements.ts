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

  getAudioTrackProxyForClip(
    mediaFileId: string | undefined,
    clipId: string,
  ): HTMLAudioElement | null {
    if (!mediaFileId) return null;
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
    });
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
  ): HTMLAudioElement | null {
    const existingMediaFileId = activeStore.mediaFileIds.get(clipId);
    if (existingMediaFileId && existingMediaFileId !== mediaFileId) {
      this.removeActiveAudioProxy(clipId, activeStore);
    }

    const mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFileId);
    if (!hasUsableAudioProxy(mediaFile)) {
      if (activeStore.elements.has(clipId)) {
        this.removeActiveAudioProxy(clipId, activeStore);
      }
      return null;
    }

    const existing = activeStore.elements.get(clipId);
    if (existing && activeStore.mediaFileIds.get(clipId) === mediaFileId && (existing.currentSrc || existing.src)) {
      return existing;
    }

    const sharedProxy = proxyFrameCache.getCachedAudioProxy(mediaFileId);
    if (!sharedProxy) {
      void proxyFrameCache.preloadAudioProxy(mediaFileId);
      return null;
    }

    const src = sharedProxy.currentSrc || sharedProxy.src;
    if (!src) return null;

    const currentExisting = activeStore.elements.get(clipId);
    if (currentExisting && (currentExisting.currentSrc || currentExisting.src) === src) {
      activeStore.mediaFileIds.set(clipId, mediaFileId);
      return currentExisting;
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
      if (currentExisting) {
        this.removeActiveAudioProxy(clipId, activeStore);
      }
      return null;
    }

    pauseAudioElement(currentExisting);
    if (currentExisting) {
      audioRoutingManager.removeRoute(currentExisting);
      this.releaseElementResource(currentExisting);
    }
    const proxyInstance = createAudioProxyInstance(sharedProxy);
    if (!proxyInstance) {
      this.releaseResource(resource.id);
      return null;
    }
    this.retainElementResource(proxyInstance, resource);
    activeStore.elements.set(clipId, proxyInstance);
    activeStore.mediaFileIds.set(clipId, mediaFileId);
    return proxyInstance;
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
      audioRoutingManager.removeRoute(existing);
      this.releaseElementResource(existing);
    }
    activeStore.elements.delete(clipId);
    activeStore.mediaFileIds.delete(clipId);
  }
}
