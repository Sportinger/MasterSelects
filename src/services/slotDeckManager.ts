import type { TimelineClip } from '../types/timeline';
import { flags } from '../engine/featureFlags';
import type { Composition, SlotDeckState } from '../stores/mediaStore/types';
import { useMediaStore } from '../stores/mediaStore';
import { renderHostPort } from './render/renderHostPort';
import {
  bindSourceRuntimeForOwner,
  planSourceRuntimeBindingForOwner,
} from './mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from './mediaRuntime/registry';
import { vectorAnimationRuntimeManager } from './vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType, type VectorAnimationProvider } from '../types/vectorAnimation';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
  reservePlannedClipRuntimeResources,
} from './timeline/runtimeResourceReporting';
import {
  startTimelineImageHydration,
  type TimelineImageHydrationHandle,
} from './timeline/imageRuntimeHydrator';
import { buildSlotDeckClip } from './slotDeck/clipPlanning';
import { findEvictionCandidate, resolveAssignedCompositionId } from './slotDeck/planning';
import { createSlotDeckImageDemand, getRuntimeSrcKind } from './slotDeck/runtimePlanning';
import {
  buildDeckState,
  createDisposedSlotDeckState,
  createPinnedWarmingSlotDeckState,
  markSlotDeckClipReady,
  sanitizeSlotDeckError,
} from './slotDeck/state';
import type {
  DecoderMode,
  PreparedSlotDeck,
  SlotDeckEntry,
  SlotDeckManagerSnapshot,
} from './slotDeck/types';

const SLOT_DECK_SOFT_CAP = 8;

export type { PreparedSlotDeck, SlotDeckManagerSnapshot } from './slotDeck/types';

class SlotDeckManager {
  private decks = new Map<number, SlotDeckEntry>();
  private pendingImageHydrations = new Map<string, TimelineImageHydrationHandle>();
  private pendingVideoDisposers = new Map<string, () => void>();

  constructor() {
    (globalThis as typeof globalThis & { __slotDeckManager?: SlotDeckManager }).__slotDeckManager = this;
  }

  private getDeckOwnerId(slotIndex: number, clipId: string): string {
    return `slot-deck:${slotIndex}:${clipId}`;
  }

  private cleanupVideoElement(video: HTMLVideoElement): void {
    video.pause();
    renderHostPort.cleanupVideo(video);
    video.removeAttribute('src');
    video.src = '';
    try {
      video.load();
    } catch {
      // Browser teardown can race media loading; releasing GPU/cache state is the important part.
    }
  }

  private disposePendingVideo(ownerId: string): void {
    const dispose = this.pendingVideoDisposers.get(ownerId);
    if (!dispose) {
      return;
    }
    dispose();
  }

  private pushDeckState(entry: SlotDeckEntry): void {
    const mediaStore = useMediaStore.getState();
    const setSlotDeckState = mediaStore.setSlotDeckState as
      | ((slotIndex: number, next: SlotDeckState) => void)
      | undefined;
    setSlotDeckState?.(entry.slotIndex, buildDeckState(entry));
  }

  private pushDisposedState(slotIndex: number): void {
    const mediaStore = useMediaStore.getState();
    const setSlotDeckState = mediaStore.setSlotDeckState as
      | ((slotIndex: number, next: SlotDeckState) => void)
      | undefined;
    setSlotDeckState?.(slotIndex, createDisposedSlotDeckState(slotIndex));
  }

  private resolveComposition(compositionId: string): Composition | null {
    return useMediaStore.getState().compositions.find((comp) => comp.id === compositionId) ?? null;
  }

  private enforceSoftCap(preferredPreserveSlotIndex?: number | null): void {
    while (this.decks.size > SLOT_DECK_SOFT_CAP) {
      const candidate = findEvictionCandidate(this.decks.values(), preferredPreserveSlotIndex);
      if (!candidate) {
        return;
      }
      this.disposeEntry(candidate);
    }
  }

  private markClipReady(entry: SlotDeckEntry, mode: DecoderMode, options?: { visual?: boolean }): void {
    if (this.decks.get(entry.slotIndex) !== entry) {
      return;
    }

    markSlotDeckClipReady(entry, mode, Date.now(), options);
    this.pushDeckState(entry);
  }

  private markDeckFailure(entry: SlotDeckEntry, error: unknown): void {
    if (this.decks.get(entry.slotIndex) !== entry) {
      return;
    }

    entry.status = 'failed';
    entry.lastError = sanitizeSlotDeckError(error);
    this.pushDeckState(entry);
  }

  private disposeEntry(entry: SlotDeckEntry): void {
    for (const clip of entry.clips) {
      const ownerId = this.getDeckOwnerId(entry.slotIndex, clip.id);
      this.pendingImageHydrations.get(ownerId)?.cancel();
      this.pendingImageHydrations.delete(ownerId);
      this.disposePendingVideo(ownerId);
      releaseReportedClipRuntimeResources('slot-deck', ownerId);
      if (clip.source?.runtimeSourceId && clip.source.runtimeSessionKey) {
        mediaRuntimeRegistry.releaseSession(
          clip.source.runtimeSourceId,
          clip.source.runtimeSessionKey
        );
        mediaRuntimeRegistry.releaseRuntime(
          clip.source.runtimeSourceId,
          ownerId
        );
      }
      if (clip.source?.videoElement) {
        this.cleanupVideoElement(clip.source.videoElement);
      }
      if (clip.source?.audioElement) {
        clip.source.audioElement.pause();
        clip.source.audioElement.src = '';
        clip.source.audioElement.load();
      }
      if (clip.source?.imageElement) {
        clip.source.imageElement.removeAttribute('src');
        clip.source.imageElement.src = '';
      }
      if (isVectorAnimationSourceType(clip.source?.type)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
      }
    }
    this.decks.delete(entry.slotIndex);
    this.pushDisposedState(entry.slotIndex);
  }

  private loadVideoForClip(entry: SlotDeckEntry, clip: TimelineClip, url: string, mediaFileId: string): boolean {
    const ownerId = this.getDeckOwnerId(entry.slotIndex, clip.id);
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId,
      source: {
        type: 'video',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'slot-deck',
      ownerId,
      ownerType: 'slot',
      compositionId: entry.compositionId,
      clip,
      source: runtimePlan?.source ?? {
        type: 'video',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaElementKind: 'video',
      srcKind: getRuntimeSrcKind(url),
      label: `Slot ${entry.slotIndex} clip resource`,
      tags: ['slot-deck', `slot-${entry.slotIndex}`],
    });
    if (!admission.admitted) {
      clip.isLoading = false;
      if (this.decks.get(entry.slotIndex) === entry && !entry.pendingDispose) {
        this.pushDeckState(entry);
      }
      return false;
    }

    this.disposePendingVideo(ownerId);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    let disposed = false;
    const disposePending = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      video.removeEventListener('canplaythrough', onCanPlayThrough);
      video.removeEventListener('error', onError);
      admission.release();
      this.cleanupVideoElement(video);
      if (this.pendingVideoDisposers.get(ownerId) === disposePending) {
        this.pendingVideoDisposers.delete(ownerId);
      }
    };
    const onCanPlayThrough = () => {
      if (disposed) {
        return;
      }
      if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
        disposePending();
        return;
      }

      disposed = true;
      video.removeEventListener('error', onError);
      if (this.pendingVideoDisposers.get(ownerId) === disposePending) {
        this.pendingVideoDisposers.delete(ownerId);
      }
      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'video',
          videoElement: video,
          naturalDuration: video.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      this.reportClipResources(entry, clip);
      clip.isLoading = false;
      renderHostPort.preCacheVideoFrame(video);
      this.markClipReady(entry, 'html', { visual: true });
    };

    const onError = (event: Event) => {
      disposePending();
      clip.isLoading = false;
      this.markDeckFailure(entry, event);
    };

    this.pendingVideoDisposers.set(ownerId, disposePending);
    video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
    video.addEventListener('error', onError, { once: true });

    return true;
  }

  private loadAudioForClip(entry: SlotDeckEntry, clip: TimelineClip, url: string, mediaFileId: string): boolean {
    const ownerId = this.getDeckOwnerId(entry.slotIndex, clip.id);
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId,
      source: {
        type: 'audio',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'slot-deck',
      ownerId,
      ownerType: 'slot',
      compositionId: entry.compositionId,
      clip,
      source: runtimePlan?.source ?? {
        type: 'audio',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaElementKind: 'audio',
      srcKind: getRuntimeSrcKind(url),
      label: `Slot ${entry.slotIndex} clip resource`,
      tags: ['slot-deck', `slot-${entry.slotIndex}`],
    });
    if (!admission.admitted) {
      clip.isLoading = false;
      if (this.decks.get(entry.slotIndex) === entry && !entry.pendingDispose) {
        this.pushDeckState(entry);
      }
      return false;
    }

    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    audio.addEventListener('canplaythrough', () => {
      if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
        admission.release();
        audio.pause();
        audio.src = '';
        audio.load();
        return;
      }

      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'audio',
          audioElement: audio,
          naturalDuration: audio.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      this.reportClipResources(entry, clip);
      clip.isLoading = false;
      this.markClipReady(entry, 'html');
    }, { once: true });

    audio.addEventListener('error', (event) => {
      admission.release();
      clip.isLoading = false;
      this.markDeckFailure(entry, event);
    }, { once: true });

    return true;
  }

  private loadImageForClip(entry: SlotDeckEntry, clip: TimelineClip, url: string): boolean {
    const ownerId = this.getDeckOwnerId(entry.slotIndex, clip.id);
    this.pendingImageHydrations.get(ownerId)?.cancel();
    const handle = startTimelineImageHydration({
      url,
      resource: {
        demand: createSlotDeckImageDemand(entry, clip, ownerId, url),
        imageId: `${ownerId}:image`,
        label: 'Slot deck image hydration',
        tags: ['slot-deck', 'image'],
      },
      isCurrent: () => this.decks.get(entry.slotIndex) === entry && !entry.pendingDispose,
      onReady: (image) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.source = bindSourceRuntimeForOwner({
          ownerId,
          source: {
            type: 'image',
            imageElement: image,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          },
          mediaFileId: clip.mediaFileId,
          sessionPolicy: 'background',
          sessionOwnerId: ownerId,
        });
        this.reportClipResources(entry, clip);
        clip.isLoading = false;
        this.markClipReady(entry, 'html', { visual: true });
      },
      onError: (event) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
        this.markDeckFailure(entry, event);
      },
      onStale: () => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
      },
      onAdmissionDenied: (decision) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
        if (this.decks.get(entry.slotIndex) === entry && !entry.pendingDispose) {
          this.pushDeckState(entry);
        }
        void decision;
      },
    });
    if (!handle.admitted) {
      return false;
    }
    this.pendingImageHydrations.set(ownerId, handle);
    return true;
  }

  private loadVectorAnimationForClip(entry: SlotDeckEntry, clip: TimelineClip, file: File, sourceType: VectorAnimationProvider): void {
    void (async () => {
      try {
        if (clip.source?.type !== sourceType) {
          clip.source = {
            type: sourceType,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          };
        }

        const ownerId = this.getDeckOwnerId(entry.slotIndex, clip.id);
        const runtime = await vectorAnimationRuntimeManager.prepareClipSource(clip, file, {
          policyId: 'slot-deck',
          ownerId,
          ownerType: 'slot',
          label: `Slot ${entry.slotIndex} vector runtime canvas`,
          tags: ['slot-deck', `slot-${entry.slotIndex}`, 'vector-animation'],
        });
        if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
          vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, sourceType);
          return;
        }

        const naturalDuration =
          runtime.metadata.duration ??
          clip.source?.naturalDuration ??
          clip.duration;
        clip.file = file;
        clip.source = {
          type: sourceType,
          textCanvas: runtime.canvas,
          mediaFileId: clip.mediaFileId,
          naturalDuration,
          vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        };
        this.reportClipResources(entry, clip);
        clip.isLoading = false;
        vectorAnimationRuntimeManager.renderClipAtTime(clip, clip.startTime);
        this.markClipReady(entry, 'html', { visual: true });
      } catch (error) {
        clip.isLoading = false;
        this.markDeckFailure(entry, error);
      }
    })();
  }

  private reportClipResources(entry: SlotDeckEntry, clip: TimelineClip): void {
    reportClipRuntimeResources({
      policyId: 'slot-deck',
      ownerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
      ownerType: 'slot',
      clip,
      compositionId: entry.compositionId,
      label: `Slot ${entry.slotIndex} clip resource`,
      tags: ['slot-deck', `slot-${entry.slotIndex}`],
    });
  }

  prepareSlot(slotIndex: number, compositionId: string): void {
    if (!flags.useWarmSlotDecks) {
      return;
    }

    const existing = this.decks.get(slotIndex);
    if (
      existing &&
      existing.compositionId === compositionId &&
      !existing.pendingDispose &&
      existing.status !== 'failed' &&
      existing.status !== 'disposed'
    ) {
      return;
    }

    if (existing && existing.pinnedLayerIndex !== null) {
      existing.pendingDispose = true;
      existing.status = 'warming';
      existing.lastError = null;
      existing.lastPreparedAt = Date.now();
      const mediaStore = useMediaStore.getState();
      const setSlotDeckState = mediaStore.setSlotDeckState as
        | ((slotIndex: number, next: SlotDeckState) => void)
        | undefined;
      setSlotDeckState?.(
        slotIndex,
        createPinnedWarmingSlotDeckState(
          slotIndex,
          compositionId,
          existing.pinnedLayerIndex,
          Date.now()
        )
      );
      return;
    }

    if (existing) {
      this.disposeEntry(existing);
    }

    const composition = this.resolveComposition(compositionId);
    if (!composition) {
      return;
    }

    const entry: SlotDeckEntry = {
      slotIndex,
      compositionId,
      composition,
      clips: [],
      tracks: composition.timelineData?.tracks ?? [],
      duration: composition.duration,
      status: 'warming',
      preparedClipCount: 0,
      readyClipCount: 0,
      firstFrameReady: false,
      decoderMode: 'unknown',
      lastPreparedAt: Date.now(),
      lastActivatedAt: null,
      lastError: null,
      pinnedLayerIndex: null,
      pendingDispose: false,
    };

    this.decks.set(slotIndex, entry);
    this.pushDeckState(entry);
    this.enforceSoftCap(slotIndex);

    const timelineData = composition.timelineData;
    if (!timelineData?.clips?.length) {
      entry.status = 'warm';
      entry.firstFrameReady = true;
      this.pushDeckState(entry);
      return;
    }

    const { files } = useMediaStore.getState();

    for (const serializedClip of timelineData.clips) {
      const mediaFile = files.find((file) => file.id === serializedClip.mediaFileId);
      const clip = buildSlotDeckClip(serializedClip, mediaFile);

      const sourceType = serializedClip.sourceType;
      const fileUrl = mediaFile?.url;

      if (sourceType === 'video' && fileUrl && serializedClip.mediaFileId) {
        clip.isLoading = true;
        if (this.loadVideoForClip(entry, clip, fileUrl, serializedClip.mediaFileId)) {
          entry.preparedClipCount += 1;
        }
      } else if (sourceType === 'audio' && fileUrl && serializedClip.mediaFileId) {
        clip.isLoading = true;
        if (this.loadAudioForClip(entry, clip, fileUrl, serializedClip.mediaFileId)) {
          entry.preparedClipCount += 1;
        }
      } else if (sourceType === 'image' && fileUrl) {
        clip.isLoading = true;
        if (this.loadImageForClip(entry, clip, fileUrl)) {
          entry.preparedClipCount += 1;
        } else {
          clip.isLoading = false;
        }
      } else if (isVectorAnimationSourceType(sourceType) && mediaFile?.file) {
        entry.preparedClipCount += 1;
        clip.isLoading = true;
        clip.source = {
          type: sourceType,
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        };
        this.loadVectorAnimationForClip(entry, clip, mediaFile.file, sourceType);
      } else {
        clip.isLoading = false;
      }

      entry.clips.push(clip);
    }

    if (entry.preparedClipCount === 0) {
      entry.status = 'warm';
      entry.firstFrameReady = true;
      this.pushDeckState(entry);
      return;
    }

    this.pushDeckState(entry);
  }

  disposeSlot(slotIndex: number): void {
    const entry = this.decks.get(slotIndex);
    if (!entry) {
      return;
    }

    if (entry.pinnedLayerIndex !== null) {
      entry.pendingDispose = true;
      this.pushDeckState(entry);
      return;
    }

    this.disposeEntry(entry);
  }

  disposeAll(): void {
    for (const entry of Array.from(this.decks.values())) {
      this.disposeEntry(entry);
    }
  }

  adoptDeckToLayer(slotIndex: number, layerIndex: number, _initialElapsed?: number): boolean {
    if (!flags.useWarmSlotDecks) {
      return false;
    }

    const entry = this.decks.get(slotIndex);
    if (!entry || entry.pendingDispose || entry.status === 'failed' || entry.status === 'disposed') {
      return false;
    }

    entry.pinnedLayerIndex = layerIndex;
    entry.lastActivatedAt = Date.now();
    if (entry.firstFrameReady) {
      entry.status = 'hot';
    }
    this.pushDeckState(entry);
    return true;
  }

  releaseLayerPin(slotIndex: number, layerIndex: number): void {
    const entry = this.decks.get(slotIndex);
    if (!entry || entry.pinnedLayerIndex !== layerIndex) {
      return;
    }

    entry.pinnedLayerIndex = null;

    if (entry.pendingDispose) {
      const { slotAssignments } = useMediaStore.getState();
      const nextCompositionId = resolveAssignedCompositionId(slotAssignments, slotIndex);
      this.disposeEntry(entry);
      if (nextCompositionId) {
        this.prepareSlot(slotIndex, nextCompositionId);
      }
      return;
    }

    if (entry.status === 'hot' && !entry.firstFrameReady) {
      entry.status = 'warm';
    }
    this.pushDeckState(entry);
    this.enforceSoftCap();
  }

  getSlotState(slotIndex: number): SlotDeckState | null {
    const entry = this.decks.get(slotIndex);
    return entry ? buildDeckState(entry) : null;
  }

  getPreparedDeck(slotIndex: number, compositionId?: string): PreparedSlotDeck | null {
    const entry = this.decks.get(slotIndex);
    if (!entry || entry.pendingDispose) {
      return null;
    }
    if (compositionId && entry.compositionId !== compositionId) {
      return null;
    }
    if (entry.status === 'failed' || entry.status === 'disposed') {
      return null;
    }
    return entry;
  }

  getSnapshot(): SlotDeckManagerSnapshot {
    const states = Array.from(this.decks.values())
      .map((entry) => buildDeckState(entry))
      .sort((left, right) => left.slotIndex - right.slotIndex);

    return {
      softCap: SLOT_DECK_SOFT_CAP,
      deckCount: states.length,
      pinnedDeckCount: states.filter((state) => state.pinnedLayerIndex !== null).length,
      states,
    };
  }
}

export const slotDeckManager = new SlotDeckManager();
