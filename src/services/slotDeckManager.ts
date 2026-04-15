import type { TimelineClip, TimelineTrack } from '../types';
import { engine } from '../engine/WebGPUEngine';
import { flags } from '../engine/featureFlags';
import type { Composition, SlotDeckState } from '../stores/mediaStore/types';
import { useMediaStore } from '../stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../stores/timeline/constants';
import { bindSourceRuntimeForOwner } from './mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from './mediaRuntime/registry';
import { lottieRuntimeManager } from './vectorAnimation/LottieRuntimeManager';

type DecoderMode = SlotDeckState['decoderMode'];
type SlotDeckStatus = SlotDeckState['status'];

const SLOT_DECK_SOFT_CAP = 8;

export interface PreparedSlotDeck {
  slotIndex: number;
  compositionId: string;
  composition: Composition;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  duration: number;
}

export interface SlotDeckManagerSnapshot {
  softCap: number;
  deckCount: number;
  pinnedDeckCount: number;
  states: SlotDeckState[];
}

interface SlotDeckEntry extends PreparedSlotDeck {
  status: SlotDeckStatus;
  preparedClipCount: number;
  readyClipCount: number;
  firstFrameReady: boolean;
  decoderMode: DecoderMode;
  lastPreparedAt: number | null;
  lastActivatedAt: number | null;
  lastError: string | null;
  pinnedLayerIndex: number | null;
  pendingDispose: boolean;
}

function resolveAssignedCompositionId(slotIndex: number): string | null {
  const { slotAssignments } = useMediaStore.getState();
  for (const [compId, assignedSlotIndex] of Object.entries(slotAssignments)) {
    if (assignedSlotIndex === slotIndex) {
      return compId;
    }
  }
  return null;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

class SlotDeckManager {
  private decks = new Map<number, SlotDeckEntry>();

  constructor() {
    (globalThis as typeof globalThis & { __slotDeckManager?: SlotDeckManager }).__slotDeckManager = this;
  }

  private getDeckOwnerId(slotIndex: number, clipId: string): string {
    return `slot-deck:${slotIndex}:${clipId}`;
  }

  private buildDeckState(entry: SlotDeckEntry): SlotDeckState {
    return {
      slotIndex: entry.slotIndex,
      compositionId: entry.pendingDispose ? null : entry.compositionId,
      status: entry.pendingDispose ? 'disposed' : entry.status,
      preparedClipCount: entry.preparedClipCount,
      readyClipCount: entry.readyClipCount,
      firstFrameReady: entry.firstFrameReady,
      decoderMode: entry.decoderMode,
      lastPreparedAt: entry.lastPreparedAt,
      lastActivatedAt: entry.lastActivatedAt,
      lastError: entry.lastError,
      pinnedLayerIndex: entry.pinnedLayerIndex,
    };
  }

  private pushDeckState(entry: SlotDeckEntry): void {
    const mediaStore = useMediaStore.getState();
    const setSlotDeckState = mediaStore.setSlotDeckState as
      | ((slotIndex: number, next: SlotDeckState) => void)
      | undefined;
    setSlotDeckState?.(entry.slotIndex, this.buildDeckState(entry));
  }

  private pushDisposedState(slotIndex: number): void {
    const mediaStore = useMediaStore.getState();
    const setSlotDeckState = mediaStore.setSlotDeckState as
      | ((slotIndex: number, next: SlotDeckState) => void)
      | undefined;
    setSlotDeckState?.(slotIndex, {
      slotIndex,
      compositionId: null,
      status: 'disposed',
      preparedClipCount: 0,
      readyClipCount: 0,
      firstFrameReady: false,
      decoderMode: 'unknown',
      lastPreparedAt: null,
      lastActivatedAt: null,
      lastError: null,
      pinnedLayerIndex: null,
    });
  }

  private resolveComposition(compositionId: string): Composition | null {
    return useMediaStore.getState().compositions.find((comp) => comp.id === compositionId) ?? null;
  }

  private updateDecoderMode(current: DecoderMode, next: DecoderMode): DecoderMode {
    if (current === 'unknown') {
      return next;
    }
    if (current === next) {
      return current;
    }
    return 'mixed';
  }

  private getEvictionTimestamp(entry: SlotDeckEntry): number {
    return Math.max(entry.lastActivatedAt ?? 0, entry.lastPreparedAt ?? 0);
  }

  private getEvictionCandidates(): SlotDeckEntry[] {
    return Array.from(this.decks.values()).filter(
      (entry) => entry.pinnedLayerIndex === null && !entry.pendingDispose && entry.status !== 'disposed'
    );
  }

  private findEvictionCandidate(preferredPreserveSlotIndex?: number | null): SlotDeckEntry | null {
    const candidates = this.getEvictionCandidates();
    if (candidates.length === 0) {
      return null;
    }

    const pool =
      preferredPreserveSlotIndex === undefined || preferredPreserveSlotIndex === null
        ? candidates
        : candidates.filter((entry) => entry.slotIndex !== preferredPreserveSlotIndex);

    if (pool.length === 0) {
      return null;
    }

    pool.sort((left, right) => {
      const timestampDiff = this.getEvictionTimestamp(left) - this.getEvictionTimestamp(right);
      if (timestampDiff !== 0) {
        return timestampDiff;
      }
      return left.slotIndex - right.slotIndex;
    });

    return pool[0] ?? null;
  }

  private enforceSoftCap(preferredPreserveSlotIndex?: number | null): void {
    while (this.decks.size > SLOT_DECK_SOFT_CAP) {
      const candidate = this.findEvictionCandidate(preferredPreserveSlotIndex);
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

    entry.readyClipCount = Math.min(entry.preparedClipCount, entry.readyClipCount + 1);
    entry.decoderMode = this.updateDecoderMode(entry.decoderMode, mode);
    entry.lastPreparedAt = Date.now();

    if (options?.visual) {
      entry.firstFrameReady = true;
    }

    if (entry.readyClipCount >= entry.preparedClipCount) {
      entry.status = entry.firstFrameReady ? 'hot' : 'warm';
    }

    this.pushDeckState(entry);
  }

  private markDeckFailure(entry: SlotDeckEntry, error: unknown): void {
    if (this.decks.get(entry.slotIndex) !== entry) {
      return;
    }

    entry.status = 'failed';
    entry.lastError = sanitizeError(error);
    this.pushDeckState(entry);
  }

  private disposeEntry(entry: SlotDeckEntry): void {
    for (const clip of entry.clips) {
      if (clip.source?.runtimeSourceId && clip.source.runtimeSessionKey) {
        mediaRuntimeRegistry.releaseSession(
          clip.source.runtimeSourceId,
          clip.source.runtimeSessionKey
        );
        mediaRuntimeRegistry.releaseRuntime(
          clip.source.runtimeSourceId,
          this.getDeckOwnerId(entry.slotIndex, clip.id)
        );
      }
      if (clip.source?.videoElement) {
        clip.source.videoElement.pause();
        clip.source.videoElement.src = '';
        clip.source.videoElement.load();
      }
      if (clip.source?.audioElement) {
        clip.source.audioElement.pause();
        clip.source.audioElement.src = '';
        clip.source.audioElement.load();
      }
      if (clip.source?.type === 'lottie') {
        lottieRuntimeManager.destroyClipRuntime(clip.id);
      }
    }
    this.decks.delete(entry.slotIndex);
    this.pushDisposedState(entry.slotIndex);
  }

  private loadVideoForClip(entry: SlotDeckEntry, clip: TimelineClip, url: string, mediaFileId: string): void {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    video.addEventListener('canplaythrough', () => {
      if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
        video.pause();
        video.src = '';
        video.load();
        return;
      }

      clip.source = bindSourceRuntimeForOwner({
        ownerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
        source: {
          type: 'video',
          videoElement: video,
          naturalDuration: video.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
      });
      clip.isLoading = false;
      engine.preCacheVideoFrame?.(video);
      this.markClipReady(entry, 'html', { visual: true });
    }, { once: true });

    video.addEventListener('error', (event) => {
      clip.isLoading = false;
      this.markDeckFailure(entry, event);
    }, { once: true });
  }

  private loadAudioForClip(entry: SlotDeckEntry, clip: TimelineClip, url: string, mediaFileId: string): void {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    audio.addEventListener('canplaythrough', () => {
      if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
        audio.pause();
        audio.src = '';
        audio.load();
        return;
      }

      clip.source = bindSourceRuntimeForOwner({
        ownerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
        source: {
          type: 'audio',
          audioElement: audio,
          naturalDuration: audio.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
      });
      clip.isLoading = false;
      this.markClipReady(entry, 'html');
    }, { once: true });

    audio.addEventListener('error', (event) => {
      clip.isLoading = false;
      this.markDeckFailure(entry, event);
    }, { once: true });
  }

  private loadImageForClip(entry: SlotDeckEntry, clip: TimelineClip, url: string): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;

    image.addEventListener('load', () => {
      if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
        image.src = '';
        return;
      }

      clip.source = bindSourceRuntimeForOwner({
        ownerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
        source: {
          type: 'image',
          imageElement: image,
        },
        mediaFileId: clip.mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: this.getDeckOwnerId(entry.slotIndex, clip.id),
      });
      clip.isLoading = false;
      this.markClipReady(entry, 'html', { visual: true });
    }, { once: true });

    image.addEventListener('error', (event) => {
      clip.isLoading = false;
      this.markDeckFailure(entry, event);
    }, { once: true });
  }

  private loadLottieForClip(entry: SlotDeckEntry, clip: TimelineClip, file: File): void {
    void (async () => {
      try {
        if (clip.source?.type !== 'lottie') {
          clip.source = {
            type: 'lottie',
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          };
        }

        const runtime = await lottieRuntimeManager.prepareClipSource(clip, file);
        if (this.decks.get(entry.slotIndex) !== entry || entry.pendingDispose) {
          lottieRuntimeManager.destroyClipRuntime(clip.id);
          return;
        }

        const naturalDuration =
          runtime.metadata.duration ??
          clip.source?.naturalDuration ??
          clip.duration;
        clip.file = file;
        clip.source = {
          type: 'lottie',
          textCanvas: runtime.canvas,
          mediaFileId: clip.mediaFileId,
          naturalDuration,
          vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        };
        clip.isLoading = false;
        lottieRuntimeManager.renderClipAtTime(clip, clip.startTime);
        this.markClipReady(entry, 'html', { visual: true });
      } catch (error) {
        clip.isLoading = false;
        this.markDeckFailure(entry, error);
      }
    })();
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
      setSlotDeckState?.(slotIndex, {
        slotIndex,
        compositionId,
        status: 'warming',
        preparedClipCount: 0,
        readyClipCount: 0,
        firstFrameReady: false,
        decoderMode: 'unknown',
        lastPreparedAt: Date.now(),
        lastActivatedAt: null,
        lastError: null,
        pinnedLayerIndex: existing.pinnedLayerIndex,
      });
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
      const clip: TimelineClip = {
        id: serializedClip.id,
        trackId: serializedClip.trackId,
        name: serializedClip.name,
        file: (mediaFile?.file ?? null) as never,
        startTime: serializedClip.startTime,
        duration: serializedClip.duration,
        inPoint: serializedClip.inPoint,
        outPoint: serializedClip.outPoint,
        source: null,
        transform: serializedClip.transform || { ...DEFAULT_TRANSFORM },
        effects: serializedClip.effects || [],
        mediaFileId: serializedClip.mediaFileId,
        reversed: serializedClip.reversed,
        isComposition: serializedClip.isComposition,
        compositionId: serializedClip.compositionId,
        masks: serializedClip.masks,
      };

      const sourceType = serializedClip.sourceType;
      const fileUrl = mediaFile?.url;

      if (sourceType === 'video' && fileUrl && serializedClip.mediaFileId) {
        entry.preparedClipCount += 1;
        clip.isLoading = true;
        this.loadVideoForClip(entry, clip, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'audio' && fileUrl && serializedClip.mediaFileId) {
        entry.preparedClipCount += 1;
        clip.isLoading = true;
        this.loadAudioForClip(entry, clip, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'image' && fileUrl) {
        entry.preparedClipCount += 1;
        clip.isLoading = true;
        this.loadImageForClip(entry, clip, fileUrl);
      } else if (sourceType === 'lottie' && mediaFile?.file) {
        entry.preparedClipCount += 1;
        clip.isLoading = true;
        clip.source = {
          type: 'lottie',
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        };
        this.loadLottieForClip(entry, clip, mediaFile.file);
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
      const nextCompositionId = resolveAssignedCompositionId(slotIndex);
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
    return entry ? this.buildDeckState(entry) : null;
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
      .map((entry) => this.buildDeckState(entry))
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
