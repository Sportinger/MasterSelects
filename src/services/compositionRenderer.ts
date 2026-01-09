// CompositionRenderer - Evaluates any composition at a given time and returns renderable layers
// This enables multiple previews showing different compositions simultaneously

import type { Layer, LayerSource } from '../types';
import type { CompositionTimelineData, TimelineClip, TimelineTrack } from '../stores/timeline/types';
import type { Composition } from '../stores/mediaStore';
import { useMediaStore } from '../stores/mediaStore';

// Source cache entry for a composition
interface CompositionSources {
  compositionId: string;
  clipSources: Map<string, {
    clipId: string;
    type: 'video' | 'image' | 'audio';
    videoElement?: HTMLVideoElement;
    imageElement?: HTMLImageElement;
    file: File;
    naturalDuration: number;
  }>;
  isReady: boolean;
  lastAccessTime: number;
}

// Evaluated layer result
export interface EvaluatedLayer extends Omit<Layer, 'id'> {
  id: string;
  clipId: string;
}

class CompositionRendererService {
  // Cache of prepared sources per composition
  private compositionSources: Map<string, CompositionSources> = new Map();

  // Callbacks for when a composition is ready
  private readyCallbacks: Map<string, (() => void)[]> = new Map();

  /**
   * Prepare a composition for rendering - loads all video/image sources
   */
  async prepareComposition(compositionId: string): Promise<boolean> {
    // Already prepared?
    const existing = this.compositionSources.get(compositionId);
    if (existing?.isReady) {
      existing.lastAccessTime = Date.now();
      return true;
    }

    const composition = useMediaStore.getState().compositions.find(c => c.id === compositionId);
    if (!composition || !composition.timelineData) {
      console.warn(`[CompositionRenderer] Composition ${compositionId} not found or has no timeline data`);
      return false;
    }

    console.log(`[CompositionRenderer] Preparing composition: ${composition.name}`);

    const sources: CompositionSources = {
      compositionId,
      clipSources: new Map(),
      isReady: false,
      lastAccessTime: Date.now(),
    };

    this.compositionSources.set(compositionId, sources);

    const timelineData = composition.timelineData;
    const clips = timelineData.clips || [];
    const mediaFiles = useMediaStore.getState().files;

    // Load sources for all video/image clips
    const loadPromises: Promise<void>[] = [];

    for (const clip of clips) {
      if (!clip.source) continue;

      // Find the media file
      const mediaFileId = clip.source.mediaFileId;
      const mediaFile = mediaFiles.find(f => f.id === mediaFileId);

      if (!mediaFile?.file) {
        console.warn(`[CompositionRenderer] Media file not found for clip ${clip.id}`);
        continue;
      }

      if (clip.source.type === 'video') {
        loadPromises.push(this.loadVideoSource(sources, clip, mediaFile.file));
      } else if (clip.source.type === 'image') {
        loadPromises.push(this.loadImageSource(sources, clip, mediaFile.file));
      }
    }

    // Wait for all sources to load
    await Promise.all(loadPromises);

    sources.isReady = true;
    console.log(`[CompositionRenderer] Composition ready: ${composition.name}, ${sources.clipSources.size} sources`);

    // Notify any waiting callbacks
    const callbacks = this.readyCallbacks.get(compositionId) || [];
    callbacks.forEach(cb => cb());
    this.readyCallbacks.delete(compositionId);

    return true;
  }

  private loadVideoSource(sources: CompositionSources, clip: TimelineClip, file: File): Promise<void> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.loop = false; // We control playback manually
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';

      video.addEventListener('canplaythrough', () => {
        sources.clipSources.set(clip.id, {
          clipId: clip.id,
          type: 'video',
          videoElement: video,
          file,
          naturalDuration: video.duration || clip.source?.naturalDuration || 0,
        });
        console.log(`[CompositionRenderer] Video loaded: ${file.name}`);
        resolve();
      }, { once: true });

      video.addEventListener('error', () => {
        console.error(`[CompositionRenderer] Failed to load video: ${file.name}`);
        resolve(); // Don't block on errors
      }, { once: true });

      video.load();
    });
  }

  private loadImageSource(sources: CompositionSources, clip: TimelineClip, file: File): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        sources.clipSources.set(clip.id, {
          clipId: clip.id,
          type: 'image',
          imageElement: img,
          file,
          naturalDuration: clip.source?.naturalDuration || 5,
        });
        console.log(`[CompositionRenderer] Image loaded: ${file.name}`);
        resolve();
      };

      img.onerror = () => {
        console.error(`[CompositionRenderer] Failed to load image: ${file.name}`);
        resolve();
      };
    });
  }

  /**
   * Evaluate a composition at a specific time - returns layers ready for rendering
   */
  evaluateAtTime(compositionId: string, time: number): EvaluatedLayer[] {
    const sources = this.compositionSources.get(compositionId);
    if (!sources?.isReady) {
      return [];
    }

    sources.lastAccessTime = Date.now();

    const composition = useMediaStore.getState().compositions.find(c => c.id === compositionId);
    if (!composition?.timelineData) {
      return [];
    }

    const timelineData = composition.timelineData;
    const clips = timelineData.clips || [];
    const tracks = timelineData.tracks || [];

    // Find video tracks (in order for layering)
    const videoTracks = tracks.filter(t => t.type === 'video');

    // Build layers from bottom to top (reverse track order)
    const layers: EvaluatedLayer[] = [];

    for (let trackIndex = videoTracks.length - 1; trackIndex >= 0; trackIndex--) {
      const track = videoTracks[trackIndex];

      // Find clip at current time on this track
      const clipAtTime = clips.find(c =>
        c.trackId === track.id &&
        time >= c.startTime &&
        time < c.startTime + c.duration
      );

      if (!clipAtTime) continue;
      if (!track.visible) continue;

      const source = sources.clipSources.get(clipAtTime.id);
      if (!source) continue;

      // Calculate clip-local time (accounting for inPoint and speed)
      const clipLocalTime = (time - clipAtTime.startTime) + (clipAtTime.inPoint || 0);

      // Seek video to correct time
      if (source.videoElement) {
        const targetTime = clipAtTime.isReversed
          ? source.naturalDuration - clipLocalTime
          : clipLocalTime;

        // Only seek if significantly different (avoid micro-seeks)
        if (Math.abs(source.videoElement.currentTime - targetTime) > 0.05) {
          source.videoElement.currentTime = Math.max(0, Math.min(targetTime, source.naturalDuration));
        }
      }

      // Build layer object
      const transform = clipAtTime.transform || {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      };

      const layer: EvaluatedLayer = {
        id: `${compositionId}-${clipAtTime.id}`,
        clipId: clipAtTime.id,
        name: clipAtTime.name,
        visible: true,
        opacity: transform.opacity ?? 1,
        blendMode: 'normal',
        source: source.videoElement
          ? { type: 'video', file: source.file, videoElement: source.videoElement }
          : source.imageElement
          ? { type: 'image', file: source.file, imageElement: source.imageElement }
          : null,
        effects: clipAtTime.effects || [],
        position: transform.position || { x: 0, y: 0, z: 0 },
        scale: transform.scale || { x: 1, y: 1 },
        rotation: typeof transform.rotation === 'number'
          ? transform.rotation
          : transform.rotation?.z || 0,
      };

      layers.push(layer);
    }

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

    for (const source of sources.clipSources.values()) {
      if (source.videoElement) {
        source.videoElement.pause();
        URL.revokeObjectURL(source.videoElement.src);
      }
      if (source.imageElement) {
        URL.revokeObjectURL(source.imageElement.src);
      }
    }

    this.compositionSources.delete(compositionId);
    console.log(`[CompositionRenderer] Disposed composition: ${compositionId}`);
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
}

// Singleton instance
export const compositionRenderer = new CompositionRendererService();
