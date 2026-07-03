// Runtime-backed helpers for the FFmpeg export panel.

import { Logger } from '../../services/logger';
import { useTimelineStore } from '../../stores/timeline';
import type { Composition, MediaFile } from '../../stores/mediaStore/types';
import type { Layer } from '../../types';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
  type ActiveTransitionPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { createTimelineTransitionMediaDurationResolver } from '../../services/timeline/timelineTransitionMediaDurations';
import { prepareClipsForExport, cleanupExportMode } from '../../engine/export/ClipPreparation';
import {
  buildLayersAtTime as buildExportLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../engine/export/ExportLayerBuilder';
import { preloadGaussianSplatsForExport, preload3DAssetsForExport } from '../../engine/export/preloadGaussianSplats';
import { prepareTransitionCompositionsForExport } from '../../engine/export/prepareTransitionCompositionsForExport';
import { seekAllClipsToTime, waitForAllVideosReady } from '../../engine/export/VideoSeeker';
import { getFrameTolerance } from '../../engine/export/types';
import type { ExportClipState, ExportMode, ExportSettings, FrameContext } from '../../engine/export/types';
import type { ParallelDecodeManager } from '../../engine/ParallelDecodeManager';
import {
  createExportRunId,
  releaseExportRunResources,
  reportExportClipStates,
  reportExportOutputSurface,
  reportExportParallelDecodeResources,
  reportExportRunJob,
} from '../../services/timeline/exportRuntimeReporting';

const log = Logger.create('ExportHelpers');

interface FFmpegFrameRendererOptions {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  exportMode?: ExportMode;
  runtimeReporting?: boolean;
  runtimeExportKind?: string;
  includeAudio?: boolean;
}

const PRECISE_FFMPEG_EXPORT_DEFAULTS: Pick<ExportSettings, 'codec' | 'container' | 'bitrate'> = {
  codec: 'h264',
  container: 'mp4',
  bitrate: 10_000_000,
};

export class FFmpegFrameRenderer {
  private readonly options: FFmpegFrameRendererOptions;
  private clipStates = new Map<string, ExportClipState>();
  private parallelDecoder: ParallelDecodeManager | null = null;
  private useParallelDecode = false;
  private readonly frameTolerance: number;
  private initialized = false;
  private cancelled = false;
  private cleanedUp = false;
  private runtimeRunId: string | null = null;
  private runtimeRunReported = false;
  private lastRuntimeReportMs = Number.NEGATIVE_INFINITY;
  private mediaFiles: MediaFile[] = [];
  private mediaCompositions: Composition[] = [];

  constructor(options: FFmpegFrameRendererOptions) {
    this.options = options;
    this.frameTolerance = getFrameTolerance(options.fps);
    this.runtimeRunId = options.runtimeReporting ? createExportRunId() : null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.reportRuntimeRunJob();

    let layerBuilderStarted = false;
    try {
      const preparation = await prepareClipsForExport(
        {
          ...PRECISE_FFMPEG_EXPORT_DEFAULTS,
          width: this.options.width,
          height: this.options.height,
          fps: this.options.fps,
          startTime: this.options.startTime,
          endTime: this.options.endTime,
        },
        this.options.exportMode ?? 'precise',
        this.runtimeRunId ?? undefined
      );

      this.clipStates = preparation.clipStates;
      this.parallelDecoder = preparation.parallelDecoder;
      this.useParallelDecode = preparation.useParallelDecode;
      this.mediaFiles = preparation.mediaFiles;
      this.mediaCompositions = preparation.mediaCompositions;
      this.reportPreparedRuntimeResources(true);
      await prepareTransitionCompositionsForExport();

      const { tracks } = useTimelineStore.getState();
      initializeLayerBuilder(tracks);
      layerBuilderStarted = true;
      await preload3DAssetsForExport({
        startTime: this.options.startTime,
        endTime: this.options.endTime,
        width: this.options.width,
        height: this.options.height,
      });
      await preloadGaussianSplatsForExport({
        startTime: this.options.startTime,
        endTime: this.options.endTime,
      });

      this.initialized = true;
      log.info('Initialized FFmpeg frame renderer with runtime-backed export sessions');
    } catch (error) {
      cleanupExportMode(this.clipStates, this.parallelDecoder);
      if (layerBuilderStarted) {
        cleanupLayerBuilder();
      }
      this.releaseRuntimeResources();
      this.parallelDecoder = null;
      this.useParallelDecode = false;
      this.mediaFiles = [];
      this.mediaCompositions = [];
      throw error;
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.releaseRuntimeResources();
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  getRuntimeRunId(): string | null {
    return this.runtimeRunId;
  }

  async buildLayersAtTime(time: number): Promise<Layer[]> {
    this.ensureReady();
    this.throwIfCancelled();

    const ctx = this.createFrameContext(time);
    await seekAllClipsToTime(
      ctx,
      this.clipStates,
      this.parallelDecoder,
      this.useParallelDecode
    );
    this.reportPreparedRuntimeResources();

    this.throwIfCancelled();

    await waitForAllVideosReady(
      ctx,
      this.clipStates,
      this.parallelDecoder,
      this.useParallelDecode
    );

    this.throwIfCancelled();

    return buildExportLayersAtTime(
      ctx,
      this.clipStates,
      this.parallelDecoder,
      this.useParallelDecode
    );
  }

  cleanup(): void {
    if (this.cleanedUp) {
      return;
    }

    cleanupExportMode(this.clipStates, this.parallelDecoder);
    cleanupLayerBuilder();
    this.releaseRuntimeResources();

    this.parallelDecoder = null;
    this.useParallelDecode = false;
    this.mediaFiles = [];
    this.mediaCompositions = [];
    this.initialized = false;
    this.cleanedUp = true;

    log.info('Cleaned up FFmpeg frame renderer');
  }

  private createFrameContext(time: number): FrameContext {
    const state = useTimelineStore.getState();
    const getMediaDuration = createTimelineTransitionMediaDurationResolver();
    const clipsAtTime = state.getClipsAtTime(time);
    const trackMap = new Map(state.tracks.map(track => [track.id, track]));
    const clipsByTrack = new Map(clipsAtTime.map(clip => [clip.trackId, clip]));
    const transitionParticipantsByTrack = new Map<string, ActiveTransitionPlan>();
    const renderClipsById = new Map(clipsAtTime.map(clip => [clip.id, clip]));

    for (const track of state.tracks) {
      if (track.type !== 'video') continue;

      const transition = findActiveTransitionPlanForTrack({
        clips: state.clips,
        trackId: track.id,
        time,
        placement: DEFAULT_TRANSITION_PLACEMENT,
        edgePolicy: 'hold',
        getMediaDuration,
      });
      if (!transition) continue;

      transitionParticipantsByTrack.set(track.id, transition);
      renderClipsById.set(
        transition.outgoingClip.id,
        createTransitionSourceClip(transition.outgoingClip, transition.plan.outgoing, time),
      );
      renderClipsById.set(
        transition.incomingClip.id,
        createTransitionSourceClip(transition.incomingClip, transition.plan.incoming, time),
      );
    }

    return {
      time,
      fps: this.options.fps,
      frameTolerance: this.frameTolerance,
      clipsAtTime,
      renderClipsAtTime: Array.from(renderClipsById.values()),
      trackMap,
      clipsByTrack,
      transitionParticipantsByTrack,
      mediaFiles: this.mediaFiles,
      mediaCompositions: this.mediaCompositions,
      getInterpolatedTransform: state.getInterpolatedTransform,
      getInterpolatedEffects: state.getInterpolatedEffects,
      getInterpolatedColorCorrection: state.getInterpolatedColorCorrection,
      getInterpolatedVectorAnimationSettings: state.getInterpolatedVectorAnimationSettings,
      getInterpolatedTextBounds: state.getInterpolatedTextBounds,
      getSourceTimeForClip: state.getSourceTimeForClip,
      getInterpolatedSpeed: state.getInterpolatedSpeed,
    };
  }

  private ensureReady(): void {
    if (!this.initialized || this.cleanedUp) {
      throw new Error('FFmpeg frame renderer is not initialized');
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelled) {
      throw new Error('FFmpeg frame rendering cancelled');
    }
  }

  private reportRuntimeRunJob(): void {
    if (!this.runtimeRunId || this.runtimeRunReported) {
      return;
    }

    this.runtimeRunReported = true;
    reportExportRunJob({
      runId: this.runtimeRunId,
      settings: {
        ...PRECISE_FFMPEG_EXPORT_DEFAULTS,
        width: this.options.width,
        height: this.options.height,
        fps: this.options.fps,
        startTime: this.options.startTime,
        endTime: this.options.endTime,
        includeAudio: this.options.includeAudio ?? false,
        exportMode: this.options.exportMode ?? 'precise',
      },
      totalFrames: Math.max(1, Math.ceil(
        Math.max(0, this.options.endTime - this.options.startTime) * this.options.fps
      )),
      startedAtMs: Date.now(),
      exportMode: this.options.runtimeExportKind ?? this.options.exportMode ?? 'ffmpeg',
      requestedAudio: this.options.includeAudio ?? false,
      effectiveAudio: this.options.includeAudio ?? false,
    });
  }

  private reportPreparedRuntimeResources(force = false): void {
    if (!this.runtimeRunId || this.cancelled) {
      return;
    }

    const now = performance.now();
    if (!force && now - this.lastRuntimeReportMs < 1000) {
      return;
    }
    this.lastRuntimeReportMs = now;

    reportExportOutputSurface({
      runId: this.runtimeRunId,
      width: this.options.width,
      height: this.options.height,
      zeroCopy: false,
    });
    reportExportClipStates(this.runtimeRunId, this.clipStates);

    if (this.useParallelDecode && this.parallelDecoder) {
      reportExportParallelDecodeResources(
        this.runtimeRunId,
        this.parallelDecoder.getRuntimeSnapshot(),
        this.clipStates
      );
    }
  }

  private releaseRuntimeResources(): void {
    if (!this.runtimeRunId) {
      return;
    }
    releaseExportRunResources(this.runtimeRunId);
  }
}
