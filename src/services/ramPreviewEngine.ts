import type { Layer, LayerSource, NestedCompositionData, TimelineClip, TimelineTrack } from '../types';
import type { RenderSurfaceFrameContext } from './render/renderHostTypes';
import { RAM_PREVIEW_FPS } from '../stores/timeline/constants';
import {
  getNestedRamPreviewClipTime,
  getRamPreviewClipTime,
  verifyRamPreviewVideoPositions,
} from './ramPreview/clipTiming';
import {
  buildRamPreviewFrameTimes,
  getRamPreviewClipsAtTime,
  getRamPreviewProgressPercent,
  quantizeRamPreviewTime,
} from './ramPreview/framePlanning';
import {
  clipToRamPreviewLayer,
  sortRamPreviewLayersByTrackOrder,
} from './ramPreview/layerAssembly';
import { seekRamPreviewVideoFrame } from './ramPreview/videoSeeking';
import {
  getPolicyRuntimeSource,
  getRuntimeFrameProvider,
  peekRuntimeFrameProvider,
  releaseRuntimePlaybackSession,
  updateRuntimePlaybackTime,
} from './mediaRuntime/runtimePlayback';
import {
  releaseReservedRamPreviewImageElement,
  reportRamPreviewClipSource,
  reserveRamPreviewVideoSource,
  reserveRamPreviewImageElement,
  type RamPreviewImageElementAdmissionReport,
  type RamPreviewSourceReservation,
} from './timeline/ramPreviewRuntimeReporting';

// Minimal engine interface — avoids importing WebGPUEngine class directly
export interface RamPreviewRenderEngine {
  render: (layers: Layer[], frameContext: RenderSurfaceFrameContext) => void;
  cacheCompositeFrame: (time: number) => Promise<void>;
}

export interface RamPreviewOptions {
  compositionId: string;
  start: number;
  end: number;
  centerTime: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  runId?: string;
}

export interface RamPreviewDeps {
  isCancelled: () => boolean;
  isFrameCached: (quantizedTime: number) => boolean;
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  getInterpolatedSpeed: (clipId: string, time: number) => number;
  getCompositionDimensions: (compositionId: string) => { width: number; height: number };
  onFrameCached: (time: number) => void;
  onProgress: (percent: number) => void;
}

export interface RamPreviewResult {
  completed: boolean;
  frameCount: number;
}

interface RamPreviewRuntimeContext {
  runId: string;
  reportedSourceKeys: Set<string>;
  retainedRuntimeSources: Map<string, LayerSource | NonNullable<TimelineClip['source']>>;
}

interface RamPreviewImageRecord {
  element: HTMLImageElement;
  status: 'loading' | 'ready' | 'error';
  objectUrl?: string;
  sourceUrl: string;
  promise: Promise<HTMLImageElement | null>;
  reservation?: RamPreviewImageElementAdmissionReport;
}

interface RamPreviewImageSource {
  url?: string;
  file?: File;
  sourceKey: string;
}

export class RamPreviewEngine {
  private engine: RamPreviewRenderEngine;
  private imageRecords = new Map<string, RamPreviewImageRecord>();
  private admissionDenied = false;

  constructor(engine: RamPreviewRenderEngine) {
    this.engine = engine;
  }

  private getRamPreviewSource(
    clip: TimelineClip,
    sessionScope?: string
  ): TimelineClip['source'] {
    return getPolicyRuntimeSource(
      clip.source,
      'ram-preview',
      clip.id,
      sessionScope
    );
  }

  private createRuntimeContext(runId?: string): RamPreviewRuntimeContext | null {
    if (!runId) {
      return null;
    }
    return {
      runId,
      reportedSourceKeys: new Set(),
      retainedRuntimeSources: new Map(),
    };
  }

  private reportSourceForRun(
    context: RamPreviewRuntimeContext | null,
    clip: TimelineClip,
    source: LayerSource | NonNullable<TimelineClip['source']>,
    options: {
      layerId?: string;
      sourceTime?: number;
      nestedCompositionId?: string;
    } = {}
  ): void {
    if (!context) {
      return;
    }

    const sourceKey = [
      options.layerId ?? clip.id,
      source.type,
      source.runtimeSourceId ?? '',
      source.runtimeSessionKey ?? '',
      source.videoElement ? 'video' : '',
      source.imageElement ? 'image' : '',
      source.textCanvas ? 'canvas' : '',
      source.webCodecsPlayer ? 'provider' : '',
    ].join(':');

    if (context.reportedSourceKeys.has(sourceKey)) {
      return;
    }
    context.reportedSourceKeys.add(sourceKey);

    reportRamPreviewClipSource({
      runId: context.runId,
      clip,
      source,
      layerId: options.layerId,
      sourceTime: options.sourceTime,
      nestedCompositionId: options.nestedCompositionId,
    });

    if (source.runtimeSourceId && source.runtimeSessionKey) {
      context.retainedRuntimeSources.set(
        `${source.runtimeSourceId}:${source.runtimeSessionKey}`,
        source
      );
    }
  }

  private releaseRuntimeContext(context: RamPreviewRuntimeContext | null): void {
    if (!context) {
      return;
    }
    for (const source of context.retainedRuntimeSources.values()) {
      releaseRuntimePlaybackSession(source);
    }
    context.retainedRuntimeSources.clear();
  }

  private getImageSourceForClip(clip: TimelineClip): RamPreviewImageSource | null {
    if (clip.source?.imageUrl) {
      return { url: clip.source.imageUrl, sourceKey: `image-url:${clip.source.imageUrl}` };
    }

    const existingSrc = clip.source?.imageElement?.currentSrc || clip.source?.imageElement?.src;
    if (existingSrc) {
      return { url: existingSrc, sourceKey: `element-src:${existingSrc}` };
    }

    if (clip.source?.file && clip.source.file.size > 0) {
      return {
        file: clip.source.file,
        sourceKey: `source-file:${clip.source.mediaFileId ?? clip.mediaFileId ?? clip.id}:${clip.source.file.name}:${clip.source.file.size}:${clip.source.file.lastModified}`,
      };
    }

    if (clip.file && clip.file.size > 0) {
      return {
        file: clip.file,
        sourceKey: `clip-file:${clip.mediaFileId ?? clip.id}:${clip.file.name}:${clip.file.size}:${clip.file.lastModified}`,
      };
    }

    return null;
  }

  private getImageRecordKey(clip: TimelineClip, sourceKey: string): string {
    return `${clip.id}:${sourceKey}`;
  }

  private materializeImageSource(source: RamPreviewImageSource): { url: string; objectUrl?: string } | null {
    if (source.url) {
      return { url: source.url };
    }
    if (source.file) {
      const objectUrl = URL.createObjectURL(source.file);
      return { url: objectUrl, objectUrl };
    }
    return null;
  }

  private reserveImageForRun(
    clip: TimelineClip,
    source: RamPreviewImageSource,
    runtimeContext: RamPreviewRuntimeContext | null,
    options: {
      layerId?: string;
      nestedCompositionId?: string;
    } = {}
  ): RamPreviewImageElementAdmissionReport | null {
    if (!runtimeContext) {
      return null;
    }

    const report: RamPreviewImageElementAdmissionReport = {
      runId: runtimeContext.runId,
      clip,
      layerId: options.layerId,
      nestedCompositionId: options.nestedCompositionId,
      previewPath: source.url,
    };
    const admission = reserveRamPreviewImageElement(report);
    if (!admission.admitted) {
      this.admissionDenied = true;
      return null;
    }
    return report;
  }

  private reserveVideoSourceForRun(
    clip: TimelineClip,
    source: LayerSource | NonNullable<TimelineClip['source']>,
    runtimeContext: RamPreviewRuntimeContext | null,
    options: {
      layerId?: string;
      sourceTime?: number;
      nestedCompositionId?: string;
    } = {}
  ): RamPreviewSourceReservation | null {
    if (!runtimeContext) {
      return null;
    }

    const admission = reserveRamPreviewVideoSource({
      runId: runtimeContext.runId,
      clip,
      source,
      layerId: options.layerId,
      sourceTime: options.sourceTime,
      nestedCompositionId: options.nestedCompositionId,
    });
    if (!admission.admitted) {
      this.admissionDenied = true;
    }
    return admission;
  }

  private loadImageRecord(
    clip: TimelineClip,
    source: RamPreviewImageSource,
    runtimeContext: RamPreviewRuntimeContext | null,
    options: {
      layerId?: string;
      nestedCompositionId?: string;
    } = {}
  ): RamPreviewImageRecord | null {
    const key = this.getImageRecordKey(clip, source.sourceKey);
    const existing = this.imageRecords.get(key);
    if (existing) {
      return existing;
    }

    const reservation = this.reserveImageForRun(clip, source, runtimeContext, options);
    if (runtimeContext && !reservation) {
      return null;
    }

    const materializedSource = this.materializeImageSource(source);
    if (!materializedSource) {
      if (reservation) {
        releaseReservedRamPreviewImageElement(reservation);
      }
      return null;
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';

    const record: RamPreviewImageRecord = {
      element: image,
      status: 'loading',
      objectUrl: materializedSource.objectUrl,
      sourceUrl: materializedSource.url,
      promise: Promise.resolve(null),
      reservation: reservation ?? undefined,
    };

    record.promise = new Promise((resolve) => {
      if (image.complete || image.naturalWidth > 0) {
        record.status = 'ready';
        resolve(image);
        return;
      }

      image.onload = () => {
        record.status = 'ready';
        resolve(image);
      };
      image.onerror = () => {
        record.status = 'error';
        if (record.objectUrl) {
          URL.revokeObjectURL(record.objectUrl);
        }
        if (record.reservation) {
          releaseReservedRamPreviewImageElement(record.reservation);
        }
        this.imageRecords.delete(key);
        resolve(null);
      };
    });

    image.src = materializedSource.url;
    this.imageRecords.set(key, record);
    return record;
  }

  private async getImageElementForClip(
    clip: TimelineClip,
    runtimeContext: RamPreviewRuntimeContext | null,
    options: {
      layerId?: string;
      nestedCompositionId?: string;
    } = {}
  ): Promise<HTMLImageElement | null> {
    if (clip.source?.imageElement) {
      return clip.source.imageElement;
    }

    const source = this.getImageSourceForClip(clip);
    if (!source) {
      return null;
    }

    const record = this.loadImageRecord(clip, source, runtimeContext, options);
    if (!record) {
      return null;
    }
    return record.status === 'ready' ? record.element : record.promise;
  }

  /** Generate RAM preview frames spreading outward from centerTime. */
  async generate(options: RamPreviewOptions, deps: RamPreviewDeps): Promise<RamPreviewResult> {
    const { start, end, clips, tracks } = options;
    const fps = RAM_PREVIEW_FPS;
    const frameInterval = 1 / fps;
    const runtimeContext = this.createRuntimeContext(options.runId);
    this.admissionDenied = false;

    // Generate frame times spreading outward from playhead
    const frameTimes = buildRamPreviewFrameTimes(start, end, options.centerTime, frameInterval, clips);

    if (frameTimes.length === 0) {
      return { completed: true, frameCount: 0 };
    }

    try {
      const totalFrames = frameTimes.length;
      const videoTracks = tracks.filter(t => t.type === 'video');
      let completed = true;

      for (let frame = 0; frame < totalFrames; frame++) {
        if (deps.isCancelled()) {
          completed = false;
          break;
        }

        const time = frameTimes[frame];

        // Skip already-cached frames
        if (deps.isFrameCached(quantizeRamPreviewTime(time))) {
          deps.onProgress(getRamPreviewProgressPercent(frame, totalFrames));
          continue;
        }

        // Get clips at this time
        const clipsAtTime = getRamPreviewClipsAtTime(clips, time);

        // Build layers (seek videos + construct Layer objects)
        const layers = await this.buildLayersForFrame(
          time, clipsAtTime, videoTracks, deps, runtimeContext
        );

        if (this.admissionDenied) {
          completed = false;
          break;
        }

        if (deps.isCancelled()) {
          completed = false;
          break;
        }

        // Verify video positions haven't drifted
        if (!verifyRamPreviewVideoPositions(
          time,
          clipsAtTime,
          deps,
          (clip) => this.getRamPreviewSource(clip)
        )) {
          deps.onProgress(getRamPreviewProgressPercent(frame, totalFrames));
          continue;
        }

        // Render and cache
        this.engine.render(layers, {
          compositionId: options.compositionId,
          timelineTimeSeconds: time,
        });
        await this.engine.cacheCompositeFrame(time);
        deps.onFrameCached(time);

        // Update progress
        deps.onProgress(getRamPreviewProgressPercent(frame, totalFrames));

        // Yield to allow UI updates every 3 frames
        if (frame % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      return { completed, frameCount: totalFrames };
    } finally {
      this.releaseRuntimeContext(runtimeContext);
    }
  }

  /** Build Layer[] for a single frame time. */
  private async buildLayersForFrame(
    time: number,
    clipsAtTime: TimelineClip[],
    videoTracks: TimelineTrack[],
    deps: RamPreviewDeps,
    runtimeContext: RamPreviewRuntimeContext | null
  ): Promise<Layer[]> {
    const layers: Layer[] = [];

    for (const clip of clipsAtTime) {
      const track = videoTracks.find(t => t.id === clip.trackId);
      if (!track?.visible) continue;

      if (clip.source?.type === 'video' && clip.source.videoElement) {
        const layer = await this.buildVideoLayer(clip, time, deps, runtimeContext);
        if (layer) layers.push(layer);
      } else if (clip.source?.type === 'image') {
        const imageElement = await this.getImageElementForClip(clip, runtimeContext);
        if (imageElement) {
          layers.push(this.buildImageLayer(clip, imageElement, runtimeContext));
        }
      } else if (clip.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
        const layer = await this.buildNestedCompLayer(clip, time, deps, runtimeContext);
        if (layer) layers.push(layer);
      }
    }

    sortRamPreviewLayersByTrackOrder(layers, clipsAtTime, videoTracks);

    return layers;
  }

  private async buildVideoLayer(
    clip: TimelineClip,
    time: number,
    deps: RamPreviewDeps,
    runtimeContext: RamPreviewRuntimeContext | null
  ): Promise<Layer | null> {
    const clipTime = getRamPreviewClipTime(clip, time, deps);
    const video = clip.source!.videoElement!;
    const runtimeSource = this.getRamPreviewSource(clip);
    const plannedRuntimeProvider = peekRuntimeFrameProvider(runtimeSource);
    const sourceAdmission = this.reserveVideoSourceForRun(
      clip,
      {
        type: 'video',
        videoElement: video,
        webCodecsPlayer: plannedRuntimeProvider ?? undefined,
        runtimeSourceId: runtimeSource?.runtimeSourceId,
        runtimeSessionKey: runtimeSource?.runtimeSessionKey,
        mediaFileId: runtimeSource?.mediaFileId ?? clip.source?.mediaFileId ?? clip.mediaFileId,
      },
      runtimeContext,
      { sourceTime: clipTime }
    );
    if (sourceAdmission && !sourceAdmission.admitted) {
      return null;
    }

    let reported = false;
    try {
      const runtimeProvider =
        getRuntimeFrameProvider(runtimeSource, 'ram-preview') ??
        clip.source!.webCodecsPlayer ??
        null;
      const seekCompleted = await seekRamPreviewVideoFrame({
        video,
        targetTime: clipTime,
        runtimeProvider,
        timeoutMs: 200,
        runtimeSeekDelayMs: 50,
        isCancelled: deps.isCancelled,
      });
      if (!seekCompleted) return null;
      updateRuntimePlaybackTime(runtimeSource, clipTime, 'ram-preview');

      const layerSource: LayerSource = {
        type: 'video',
        videoElement: video,
        webCodecsPlayer: runtimeProvider ?? undefined,
        runtimeSourceId: runtimeSource?.runtimeSourceId,
        runtimeSessionKey: runtimeSource?.runtimeSessionKey,
      };
      this.reportSourceForRun(runtimeContext, clip, layerSource, { sourceTime: clipTime });
      reported = true;

      return clipToRamPreviewLayer(clip, layerSource);
    } finally {
      if (!reported) {
        sourceAdmission?.release();
      }
    }
  }

  private buildImageLayer(
    clip: TimelineClip,
    imageElement: HTMLImageElement,
    runtimeContext: RamPreviewRuntimeContext | null
  ): Layer {
    const layerSource: LayerSource = {
      type: 'image',
      imageElement,
      mediaFileId: clip.source!.mediaFileId,
    };
    this.reportSourceForRun(runtimeContext, clip, layerSource);
    return clipToRamPreviewLayer(clip, layerSource);
  }

  private async buildNestedCompLayer(
    clip: TimelineClip,
    time: number,
    deps: RamPreviewDeps,
    runtimeContext: RamPreviewRuntimeContext | null
  ): Promise<Layer | null> {
    const clipLocalTime = time - clip.startTime;
    const clipTime = clipLocalTime + clip.inPoint;

    const nestedVideoTracks = clip.nestedTracks?.filter(t => t.type === 'video' && t.visible) || [];
    const nestedLayers: Layer[] = [];

    for (const nestedTrack of nestedVideoTracks) {
      const nestedClip = clip.nestedClips!.find(nc =>
        nc.trackId === nestedTrack.id &&
        clipTime >= nc.startTime &&
        clipTime < nc.startTime + nc.duration
      );
      if (!nestedClip) continue;

      const nestedClipTime = getNestedRamPreviewClipTime(clipTime, nestedClip);

      if (nestedClip.source?.videoElement) {
        const nestedVideo = nestedClip.source.videoElement;
        const nestedLayerId = `nested-${nestedClip.id}`;
        const nestedCompositionId = clip.compositionId || clip.id;
        const nestedRuntimeSource = this.getRamPreviewSource(
          nestedClip,
          `composition:${nestedCompositionId}/nested:${nestedClip.id}`
        );
        const plannedRuntimeProvider = peekRuntimeFrameProvider(nestedRuntimeSource);
        const sourceAdmission = this.reserveVideoSourceForRun(
          nestedClip,
          {
            type: 'video',
            videoElement: nestedVideo,
            webCodecsPlayer: plannedRuntimeProvider ?? undefined,
            runtimeSourceId: nestedRuntimeSource?.runtimeSourceId,
            runtimeSessionKey: nestedRuntimeSource?.runtimeSessionKey,
            mediaFileId: nestedRuntimeSource?.mediaFileId ?? nestedClip.source.mediaFileId ?? nestedClip.mediaFileId,
          },
          runtimeContext,
          {
            layerId: nestedLayerId,
            sourceTime: nestedClipTime,
            nestedCompositionId,
          }
        );
        if (sourceAdmission && !sourceAdmission.admitted) {
          return null;
        }

        let reported = false;
        try {
          const nestedRuntimeProvider =
            getRuntimeFrameProvider(nestedRuntimeSource, 'ram-preview') ??
            nestedClip.source.webCodecsPlayer ??
            null;

          const seekCompleted = await seekRamPreviewVideoFrame({
            video: nestedVideo,
            targetTime: nestedClipTime,
            runtimeProvider: nestedRuntimeProvider,
            timeoutMs: 150,
            runtimeSeekDelayMs: 50,
            isCancelled: deps.isCancelled,
          });
          if (!seekCompleted) return null;
          updateRuntimePlaybackTime(
            nestedRuntimeSource,
            nestedClipTime,
            'ram-preview'
          );

          const nestedLayerSource: LayerSource = {
            type: 'video',
            videoElement: nestedVideo,
            webCodecsPlayer: nestedRuntimeProvider ?? undefined,
            runtimeSourceId: nestedRuntimeSource?.runtimeSourceId,
            runtimeSessionKey: nestedRuntimeSource?.runtimeSessionKey,
          };
          this.reportSourceForRun(runtimeContext, nestedClip, nestedLayerSource, {
            layerId: nestedLayerId,
            sourceTime: nestedClipTime,
            nestedCompositionId,
          });
          reported = true;
          nestedLayers.push(clipToRamPreviewLayer(nestedClip, nestedLayerSource, nestedLayerId));
        } finally {
          if (!reported) {
            sourceAdmission?.release();
          }
        }
      } else if (nestedClip.source?.type === 'image') {
        const nestedLayerId = `nested-${nestedClip.id}`;
        const nestedCompositionId = clip.compositionId || clip.id;
        const imageElement = await this.getImageElementForClip(nestedClip, runtimeContext, {
          layerId: nestedLayerId,
          nestedCompositionId,
        });
        if (!imageElement) {
          continue;
        }
        const nestedLayerSource: LayerSource = {
          type: 'image',
          imageElement,
          mediaFileId: nestedClip.source.mediaFileId,
        };
        this.reportSourceForRun(runtimeContext, nestedClip, nestedLayerSource, {
          layerId: nestedLayerId,
          nestedCompositionId,
        });
        nestedLayers.push(clipToRamPreviewLayer(nestedClip, nestedLayerSource, nestedLayerId));
      }
    }

    if (nestedLayers.length === 0) return null;

    const { width: compWidth, height: compHeight } = deps.getCompositionDimensions(
      clip.compositionId || clip.id
    );

    const nestedCompData: NestedCompositionData = {
      compositionId: clip.compositionId || clip.id,
      layers: nestedLayers,
      width: compWidth,
      height: compHeight,
    };

    return clipToRamPreviewLayer(clip, {
      type: 'image', nestedComposition: nestedCompData,
    });
  }
}
