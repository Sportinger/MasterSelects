// CompositionRenderer - Evaluates any composition at a given time and returns renderable layers
// This enables multiple previews showing different compositions simultaneously

import { Logger } from './logger';
import type {
  SerializableClip,
  TimelineTrack,
  TimelineClip,
} from '../types';
import type { Layer } from '../types/layers';
import type { Keyframe } from '../types/keyframes';

const log = Logger.create('CompositionRenderer');
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import { textRenderer } from './textRenderer';
import { isVectorAnimationSourceType } from '../types/vectorAnimation';
import {
  createTimelineSolidCanvasRuntime,
  createTimelineTransitionOverlayCanvasRuntime,
} from './timeline/timelineGeneratedCanvasRuntime';
import {
  buildEvaluatedClipLayer,
  evaluateNestedComposition,
  type BackgroundVideoPlaybackOptions,
} from './compositionRender/layerEvaluation';
import {
  buildSerializableMathSceneClip,
  getBackgroundSessionKey,
  getSerializableImageSource,
  getTimelineImageSource,
} from './compositionRender/sourceSetup';
import { disposeCompositionSources, reportCompositionSource } from './compositionRender/sourceLifecycle';
import {
  loadImageSource,
  loadVectorAnimationSource,
  loadVideoSource,
  prepareNestedTimelineImageSources,
} from './compositionRender/sourceLoaders';
import type {
  CompositionClipSourceEntry,
  CompositionSources,
  EvaluatedLayer,
} from './compositionRender/sourceTypes';
import { buildCompositionTransitionLayersForTrack } from './compositionRender/transitionEvaluation';
export type { EvaluatedLayer } from './compositionRender/sourceTypes';

export interface EvaluateCompositionOptions {
  playbackOptions?: BackgroundVideoPlaybackOptions;
}

function pauseInactiveCompositionVideos(
  sources: CompositionSources,
  activeClipIds: ReadonlySet<string>,
): void {
  for (const source of sources.clipSources.values()) {
    const video = source.videoElement;
    if (!video || activeClipIds.has(source.clipId) || video.paused) continue;
    video.pause();
  }
}

class CompositionRendererService {
  // Cache of prepared sources per composition
  private compositionSources: Map<string, CompositionSources> = new Map();

  // Callbacks for when a composition is ready
  private readyCallbacks: Map<string, (() => void)[]> = new Map();

  // Throttle "not ready" warnings per composition (avoid spam at 60fps)
  private notReadyWarned: Map<string, number> = new Map();

  // Track in-flight preparation promises to deduplicate concurrent calls
  private preparingPromises: Map<string, Promise<boolean>> = new Map();

  private isSourcesCurrent(sources: CompositionSources): boolean {
    return !sources.disposed && this.compositionSources.get(sources.compositionId) === sources;
  }

  /**
   * Prepare a composition for rendering - loads all video/image sources
   * Deduplicates concurrent calls for the same composition.
   */
  async prepareComposition(compositionId: string): Promise<boolean> {
    // If already preparing this composition, return the existing promise
    const existing = this.preparingPromises.get(compositionId);
    if (existing) {
      log.debug(`prepareComposition: already in-flight for ${compositionId}, reusing promise`);
      return existing;
    }

    const promise = this._doPrepareComposition(compositionId);
    this.preparingPromises.set(compositionId, promise);
    try {
      return await promise;
    } finally {
      this.preparingPromises.delete(compositionId);
    }
  }

  private async _doPrepareComposition(compositionId: string): Promise<boolean> {
    log.info(`prepareComposition called for ${compositionId}`);

    // Already prepared?
    const existing = this.compositionSources.get(compositionId);
    if (existing?.isReady) {
      log.debug(`prepareComposition: already ready, returning cached`);
      existing.lastAccessTime = Date.now();
      return true;
    }
    if (existing) {
      disposeCompositionSources(existing);
    }
    log.debug(`prepareComposition: not ready, preparing...`);

    const mediaState = useMediaStore.getState();
    const { activeCompositionId } = mediaState;
    const composition = mediaState.compositions.find(c => c.id === compositionId);

    if (!composition) {
      log.warn(`Composition ${compositionId} not found`);
      return false;
    }

    // Check if this is the active composition - use timeline store data
    const isActiveComp = compositionId === activeCompositionId;

    let clips: (SerializableClip | TimelineClip)[];

    if (isActiveComp) {
      // Active composition - use live data from timeline store
      clips = useTimelineStore.getState().clips;
      log.info(`Preparing ACTIVE composition: ${composition.name} (${clips.length} clips from timeline store)`);
    } else if (composition.timelineData) {
      // Non-active composition - use serialized data
      clips = composition.timelineData.clips || [];
      log.info(`Preparing composition: ${composition.name} (${clips.length} clips from timelineData)`);
    } else {
      log.warn(`Composition ${compositionId} has no timeline data`);
      return false;
    }

    const sources: CompositionSources = {
      compositionId,
      clipSources: new Map(),
      pendingSourceDisposers: new Map(),
      isReady: false,
      disposed: false,
      lastAccessTime: Date.now(),
    };

    this.compositionSources.set(compositionId, sources);

    const mediaFiles = mediaState.files;

    // Load sources for all video/image clips
    const loadPromises: Promise<void>[] = [];

    for (const clip of clips) {
      // Handle both TimelineClip (active) and SerializableClip (stored)
      const timelineClip = clip as TimelineClip;
      const serializableClip = clip as SerializableClip;

      // Get source type - TimelineClip has source.type, SerializableClip has sourceType
      const sourceType = timelineClip.source?.type || serializableClip.sourceType;

      // Get media file ID
      const mediaFileId = timelineClip.source?.mediaFileId || serializableClip.mediaFileId;
      const mediaFile = mediaFileId
        ? mediaFiles.find(f => f.id === mediaFileId)
        : undefined;

      log.debug(`Processing clip ${clip.id}: sourceType=${sourceType}, mediaFileId=${mediaFileId || 'NONE'}, isActive=${isActiveComp}`);

      if (isActiveComp && timelineClip.source) {
        if (
          sourceType === 'video' &&
          (timelineClip.source.videoElement ||
            timelineClip.source.webCodecsPlayer ||
            timelineClip.source.runtimeSourceId)
        ) {
          sources.clipSources.set(clip.id, {
            clipId: clip.id,
            type: 'video',
            videoElement: timelineClip.source.videoElement,
            webCodecsPlayer: timelineClip.source.webCodecsPlayer,
            file: timelineClip.file,
            naturalDuration:
              timelineClip.source.naturalDuration ||
              timelineClip.source.videoElement?.duration ||
              0,
            runtimeSourceId: timelineClip.source.runtimeSourceId,
            runtimeSessionKey: getBackgroundSessionKey(
              compositionId,
              clip.id,
              timelineClip.source
            ),
          });
          continue;
        }

        if (sourceType === 'image' && timelineClip.source.imageElement) {
          sources.clipSources.set(clip.id, {
            clipId: clip.id,
            type: 'image',
            imageElement: timelineClip.source.imageElement,
            file: timelineClip.file,
            naturalDuration: timelineClip.source.naturalDuration || 5,
            runtimeSourceId: timelineClip.source.runtimeSourceId,
            runtimeSessionKey: getBackgroundSessionKey(
              compositionId,
              clip.id,
              timelineClip.source
            ),
          });
          continue;
        }

        if (sourceType === 'image') {
          const imageSource = getTimelineImageSource(timelineClip, mediaFile);
          if (imageSource) {
            loadPromises.push(loadImageSource(
              sources,
              {
                id: timelineClip.id,
                name: timelineClip.name,
                mediaFileId,
                naturalDuration: timelineClip.source.naturalDuration || timelineClip.duration,
              },
              imageSource,
              (currentSources) => this.isSourcesCurrent(currentSources)
            ));
            continue;
          }
        }

        if ((sourceType === 'text' || sourceType === 'solid' || sourceType === 'math-scene' || sourceType === 'transition-overlay' || isVectorAnimationSourceType(sourceType)) && timelineClip.source.textCanvas) {
          sources.clipSources.set(clip.id, {
            clipId: clip.id,
            type: sourceType,
            textCanvas: timelineClip.source.textCanvas,
            naturalDuration: clip.duration,
            ...(isVectorAnimationSourceType(sourceType) ? { lottieClip: timelineClip } : {}),
            ...(sourceType === 'math-scene' ? { mathSceneClip: timelineClip } : {}),
          });
          continue;
        }
      }

      if (!mediaFileId) {
        // For active composition, the video/image/text elements are already loaded
        if (isActiveComp && timelineClip.source) {
          if (sourceType === 'video' && timelineClip.source.videoElement) {
            sources.clipSources.set(clip.id, {
              clipId: clip.id,
              type: 'video',
              videoElement: timelineClip.source.videoElement,
              webCodecsPlayer: timelineClip.source.webCodecsPlayer, // Pass through WebCodecsPlayer for hardware decoding
              file: timelineClip.file,
              naturalDuration: timelineClip.source.naturalDuration || timelineClip.source.videoElement.duration || 0,
              runtimeSourceId: timelineClip.source.runtimeSourceId,
              runtimeSessionKey: getBackgroundSessionKey(
                compositionId,
                clip.id,
                timelineClip.source
              ),
            });
          } else if (sourceType === 'image' && timelineClip.source.imageElement) {
            sources.clipSources.set(clip.id, {
              clipId: clip.id,
              type: 'image',
              imageElement: timelineClip.source.imageElement,
              file: timelineClip.file,
              naturalDuration: timelineClip.source.naturalDuration || 5,
              runtimeSourceId: timelineClip.source.runtimeSourceId,
              runtimeSessionKey: getBackgroundSessionKey(
                compositionId,
                clip.id,
                timelineClip.source
              ),
            });
          } else if ((sourceType === 'text' || sourceType === 'solid' || sourceType === 'math-scene' || sourceType === 'transition-overlay' || isVectorAnimationSourceType(sourceType)) && timelineClip.source.textCanvas) {
            sources.clipSources.set(clip.id, {
              clipId: clip.id,
              type: sourceType,
              textCanvas: timelineClip.source.textCanvas,
              naturalDuration: clip.duration,
              ...(isVectorAnimationSourceType(sourceType) ? { lottieClip: timelineClip } : {}),
              ...(sourceType === 'math-scene' ? { mathSceneClip: timelineClip } : {}),
            });
          }
        }

        // Handle text clips from serialized data (non-active composition)
        if (sourceType === 'text' && serializableClip.textProperties) {
          const textCanvas = textRenderer.render(serializableClip.textProperties);
          if (textCanvas) {
            const entry: CompositionClipSourceEntry = {
              clipId: clip.id,
              compositionId,
              type: 'text',
              textCanvas,
              naturalDuration: clip.duration,
            };
            sources.clipSources.set(clip.id, entry);
            reportCompositionSource(compositionId, entry);
          }
        }

        if (sourceType === 'math-scene' && serializableClip.mathScene) {
          const mathSceneClip = buildSerializableMathSceneClip(serializableClip);
          if (mathSceneClip?.source?.textCanvas) {
            const entry: CompositionClipSourceEntry = {
              clipId: clip.id,
              compositionId,
              type: 'math-scene',
              textCanvas: mathSceneClip.source.textCanvas,
              mathSceneClip,
              naturalDuration: clip.duration,
            };
            sources.clipSources.set(clip.id, entry);
            reportCompositionSource(compositionId, entry);
          }
        }

        if (sourceType === 'transition-overlay' && serializableClip.transitionOverlay) {
          const textCanvas = createTimelineTransitionOverlayCanvasRuntime({
            overlay: serializableClip.transitionOverlay,
            dimensions: { width: composition.width, height: composition.height },
          });
          const entry: CompositionClipSourceEntry = {
            clipId: clip.id,
            compositionId,
            type: 'transition-overlay',
            textCanvas,
            naturalDuration: clip.duration,
          };
          sources.clipSources.set(clip.id, entry);
          reportCompositionSource(compositionId, entry);
        }

        if (sourceType === 'solid' && serializableClip.solidColor) {
          const textCanvas = createTimelineSolidCanvasRuntime({
            color: serializableClip.solidColor,
            dimensions: { width: composition.width, height: composition.height },
          });
          const entry: CompositionClipSourceEntry = {
            clipId: clip.id,
            compositionId,
            type: 'solid',
            textCanvas,
            naturalDuration: clip.duration,
          };
          sources.clipSources.set(clip.id, entry);
          reportCompositionSource(compositionId, entry);
        }

        continue;
      }

      if (!mediaFile?.file && !(sourceType === 'image' && mediaFile?.url)) {
        log.warn(`Media file not found for clip ${clip.id}`, {
          mediaFileId,
          availableFileIds: mediaFiles.map(f => f.id).slice(0, 5), // First 5 for brevity
          totalFiles: mediaFiles.length,
        });
        continue;
      }

      log.debug(`Found media file for clip ${clip.id}: ${mediaFile.name}`);

      if (sourceType === 'video') {
        if (mediaFile?.file) {
          loadPromises.push(loadVideoSource(
            sources,
            serializableClip,
            mediaFile.file,
            (currentSources) => this.isSourcesCurrent(currentSources)
          ));
        }
      } else if (sourceType === 'image') {
        const imageSource = getSerializableImageSource(serializableClip, mediaFile);
        if (imageSource) {
          loadPromises.push(loadImageSource(
            sources,
            serializableClip,
            imageSource,
            (currentSources) => this.isSourcesCurrent(currentSources)
          ));
        }
      } else if (isVectorAnimationSourceType(sourceType)) {
        if (mediaFile?.file) {
          loadPromises.push(loadVectorAnimationSource(
            sources,
            serializableClip,
            mediaFile.file,
            (currentSources) => this.isSourcesCurrent(currentSources)
          ));
        }
      }
    }

    if (isActiveComp) {
      for (const clip of clips as TimelineClip[]) {
        if (!clip.nestedClips?.length) {
          continue;
        }

        prepareNestedTimelineImageSources(
          sources,
          clip.nestedClips,
          mediaFiles,
          loadPromises,
          (currentSources) => this.isSourcesCurrent(currentSources)
        );
      }
    }

    // Wait for all sources to load
    log.info(`prepareComposition: waiting for ${loadPromises.length} sources to load`);
    await Promise.all(loadPromises);

    if (!this.isSourcesCurrent(sources)) {
      return false;
    }

    sources.isReady = true;
    this.notReadyWarned.delete(compositionId);
    log.info(`Composition ready: ${composition.name}, ${sources.clipSources.size} sources loaded`);

    if (sources.clipSources.size === 0 && clips.length > 0) {
      log.warn(`prepareComposition: No sources loaded for ${clips.length} clips! Check mediaFileId values.`);
      for (const clip of clips) {
        const sc = clip as SerializableClip;
        log.warn(`  Clip ${clip.id}: sourceType=${sc.sourceType}, mediaFileId=${sc.mediaFileId || 'MISSING'}`);
      }
    }

    // Notify any waiting callbacks
    const callbacks = this.readyCallbacks.get(compositionId) || [];
    callbacks.forEach(cb => cb());
    this.readyCallbacks.delete(compositionId);

    return true;
  }

  /**
   * Evaluate a composition at a specific time - returns layers ready for rendering
   */
  evaluateAtTime(compositionId: string, time: number, options?: EvaluateCompositionOptions): EvaluatedLayer[] {
    const sources = this.compositionSources.get(compositionId);
    if (!sources?.isReady) {
      // Log at debug level — this is a normal transient state during loading, not an error
      const now = Date.now();
      const lastWarned = this.notReadyWarned.get(compositionId) || 0;
      if (now - lastWarned > 2000) {
        log.debug(`evaluateAtTime: sources not ready for ${compositionId}`);
        this.notReadyWarned.set(compositionId, now);
      }
      return [];
    }

    sources.lastAccessTime = Date.now();

    const mediaState = useMediaStore.getState();
    const { activeCompositionId, files: mediaFiles } = mediaState;
    const composition = mediaState.compositions.find(c => c.id === compositionId);
    if (!composition) {
      log.warn(`evaluateAtTime: composition not found ${compositionId}`);
      return [];
    }

    // Check if this is the active composition
    const isActiveComp = compositionId === activeCompositionId;
    log.debug(`evaluateAtTime: ${composition.name}, isActive=${isActiveComp}, time=${time.toFixed(2)}`);

    let clips: (SerializableClip | TimelineClip)[];
    let tracks: TimelineTrack[];
    let activeClipKeyframes: Map<string, Keyframe[]> | undefined;

    if (isActiveComp) {
      // Active composition - use live data from timeline store
      const timelineState = useTimelineStore.getState();
      clips = timelineState.clips;
      tracks = timelineState.tracks;
      activeClipKeyframes = timelineState.clipKeyframes;
    } else if (composition.timelineData) {
      // Non-active composition - use serialized data
      clips = composition.timelineData.clips || [];
      tracks = composition.timelineData.tracks || [];
      log.debug(`evaluateAtTime: using timelineData, ${clips.length} clips, ${tracks.length} tracks`);

      // Log clip details for debugging
      for (const clip of clips) {
        const sc = clip as SerializableClip;
        log.debug(`evaluateAtTime clip: ${sc.id}, type=${sc.sourceType}, mediaFileId=${sc.mediaFileId || 'NONE'}`);
      }
    } else {
      log.warn(`evaluateAtTime: comp ${composition.name} has NO timelineData!`);
      return [];
    }

    // Find video tracks (in order for layering)
    const videoTracks = tracks.filter((t: TimelineTrack) => t.type === 'video');
    log.debug(`evaluateAtTime: ${videoTracks.length} video tracks, clipSources: ${sources.clipSources.size}`);

    // Build layers from bottom to top (reverse track order)
    const layers: EvaluatedLayer[] = [];
    const activeVideoSourceClipIds = new Set<string>();
    const getVectorAnimationSettings = (clipId: string, localTime: number) =>
      useTimelineStore.getState().getInterpolatedVectorAnimationSettings(clipId, localTime);
    const getClipKeyframes = (clipId: string) => activeClipKeyframes?.get(clipId);

    for (let trackIndex = videoTracks.length - 1; trackIndex >= 0; trackIndex--) {
      const track = videoTracks[trackIndex];
      if (!track.visible) continue;

      const transitionLayers = buildCompositionTransitionLayersForTrack({
        compositionId,
        time,
        track,
        trackIndex,
        clips,
        sources,
        mediaFiles,
        width: composition.width,
        height: composition.height,
        isActiveComposition: isActiveComp,
        getVectorAnimationSettings,
        getClipKeyframes,
        playbackOptions: options?.playbackOptions,
        getComposition: (transitionCompositionId) =>
          mediaState.compositions.find((candidate) => candidate.id === transitionCompositionId),
        isCompositionReady: (transitionCompositionId) => this.isReady(transitionCompositionId),
        prepareComposition: (transitionCompositionId) => { void this.prepareComposition(transitionCompositionId); },
        evaluateCompositionAtTime: (transitionCompositionId, transitionCompositionTime, transitionOptions) =>
          this.evaluateAtTime(transitionCompositionId, transitionCompositionTime, transitionOptions) as Layer[],
      });
      if (transitionLayers) {
        layers.push(...transitionLayers);
        for (const layer of transitionLayers) {
          if (typeof layer.clipId === 'string') {
            activeVideoSourceClipIds.add(layer.clipId);
          }
        }
        continue;
      }

      // Find clip at current time on this track
      const clipAtTime = clips.find((c) =>
        c.trackId === track.id &&
        time >= c.startTime &&
        time < c.startTime + c.duration
      );

      if (!clipAtTime) continue;

      // Handle nested compositions
      const timelineClip = clipAtTime as TimelineClip;
      if (timelineClip.isComposition && timelineClip.compositionId) {
        const mediaStore = useMediaStore.getState();
        const nestedLayer = evaluateNestedComposition({
          clip: timelineClip,
          parentTime: time,
          parentCompId: compositionId,
          sources,
          compositions: mediaStore.compositions,
          mediaFiles: mediaStore.files,
          proxyEnabled: mediaStore.proxyEnabled,
          getVectorAnimationSettings,
          playbackOptions: options?.playbackOptions,
          getComposition: (transitionCompositionId) =>
            mediaStore.compositions.find((candidate) => candidate.id === transitionCompositionId),
          isCompositionReady: (transitionCompositionId) => this.isReady(transitionCompositionId),
          prepareComposition: (transitionCompositionId) => { void this.prepareComposition(transitionCompositionId); },
          evaluateCompositionAtTime: (transitionCompositionId, transitionCompositionTime, transitionOptions) =>
            this.evaluateAtTime(transitionCompositionId, transitionCompositionTime, transitionOptions) as Layer[],
        });
        if (nestedLayer) {
          layers.push(nestedLayer);
        }
        continue;
      }

      const source = sources.clipSources.get(clipAtTime.id);
      if (!source) continue;
      if (source.videoElement) {
        activeVideoSourceClipIds.add(source.clipId);
      }

      layers.push(buildEvaluatedClipLayer({
        compositionId,
        time,
        clipAtTime,
        source,
        isActiveComposition: isActiveComp,
        getVectorAnimationSettings,
        getClipKeyframes,
        playbackOptions: options?.playbackOptions,
      }));
    }

    pauseInactiveCompositionVideos(sources, activeVideoSourceClipIds);

    return layers;
  }

  /**
   * Check if a composition is prepared and ready
   */
  isReady(compositionId: string): boolean {
    return this.compositionSources.get(compositionId)?.isReady ?? false;
  }

  /**
   * Wait for a composition to be ready
   */
  onReady(compositionId: string, callback: () => void): void {
    if (this.isReady(compositionId)) {
      callback();
      return;
    }

    const callbacks = this.readyCallbacks.get(compositionId) || [];
    callbacks.push(callback);
    this.readyCallbacks.set(compositionId, callbacks);
  }

  /**
   * Dispose of a composition's sources
   */
  disposeComposition(compositionId: string): void {
    const sources = this.compositionSources.get(compositionId);
    if (!sources) return;

    disposeCompositionSources(sources, {
      deleteFromCache: true,
      cache: this.compositionSources,
    });
    log.debug(`Disposed composition: ${compositionId}`);
  }

  /**
   * Get list of prepared compositions
   */
  getPreparedCompositions(): string[] {
    return Array.from(this.compositionSources.keys()).filter(id =>
      this.compositionSources.get(id)?.isReady
    );
  }

  /**
   * Cleanup unused compositions (those not accessed recently)
   */
  cleanup(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [id, sources] of this.compositionSources.entries()) {
      if (now - sources.lastAccessTime > maxAgeMs) {
        this.disposeComposition(id);
      }
    }
  }

  /**
   * Invalidate a composition's cache so it gets re-prepared on next use
   * Call this when a composition's timelineData changes
   */
  invalidateComposition(compositionId: string): void {
    const sources = this.compositionSources.get(compositionId);
    if (sources) {
      log.debug(`Invalidating composition: ${compositionId}`);
      disposeCompositionSources(sources);
    }
  }

  /**
   * Invalidate all non-active compositions
   * Call this when switching active compositions (timelineData may have changed)
   */
  invalidateAllExceptActive(): void {
    const { activeCompositionId } = useMediaStore.getState();
    for (const [id, sources] of this.compositionSources.entries()) {
      if (id !== activeCompositionId) {
        disposeCompositionSources(sources);
      }
    }
    log.debug('Invalidated all non-active compositions');
  }

  /**
   * Invalidate a composition AND all parent compositions that contain it as nested
   * Call this when a composition's content changes (clips added/removed/modified)
   */
  invalidateCompositionAndParents(compositionId: string): void {
    // First invalidate the composition itself
    this.invalidateComposition(compositionId);

    // Find all parent compositions that contain this as a nested comp
    const { compositions } = useMediaStore.getState();

    for (const comp of compositions) {
      if (comp.id === compositionId) continue;

      // Check if this composition contains the changed one as a nested clip
      const clips = comp.timelineData?.clips || [];
      const hasNested = clips.some(clip =>
        (clip.isComposition && clip.compositionId === compositionId) ||
        clip.transitionOut?.compositionId === compositionId ||
        clip.transitionIn?.compositionId === compositionId
      );

      if (hasNested) {
        log.debug(`Invalidating parent composition: ${comp.name} (contains ${compositionId})`);
        this.invalidateComposition(comp.id);
        // Recursively invalidate grandparents
        this.invalidateCompositionAndParents(comp.id);
      }
    }
  }

  /**
   * Invalidate ALL cached compositions - use when major changes occur
   */
  invalidateAll(): void {
    for (const [, sources] of this.compositionSources.entries()) {
      disposeCompositionSources(sources);
    }
    log.debug('Invalidated ALL compositions');
  }
}

// Singleton instance
export const compositionRenderer = new CompositionRendererService();
