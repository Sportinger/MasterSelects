import { Logger } from '../../services/logger';
import { exportDiagnostics } from '../../services/export/exportDiagnostics';

const log = Logger.create('FrameExporter');
import { AudioExportPipeline, type EncodedAudioResult } from '../audio';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import { useTimelineStore } from '../../stores/timeline';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
  type ActiveTransitionPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { createTimelineTransitionMediaDurationResolver } from '../../services/timeline/timelineTransitionMediaDurations';
import type { FullExportSettings, ExportProgress, ExportMode, ExportClipState, FrameContext } from './types';
import { getFrameTolerance, getKeyframeInterval } from './types';
import { VideoEncoderWrapper } from './VideoEncoderWrapper';
import { prepareClipsForExport, cleanupExportMode } from './ClipPreparation';
import { seekAllClipsToTime, waitForAllVideosReady } from './VideoSeeker';
import { buildLayersAtTime, initializeLayerBuilder, cleanupLayerBuilder } from './ExportLayerBuilder';
import {
  ExportFrameCaptureUnavailableError,
  ExportRenderSessionImpl,
  type ExportRenderSessionFrameCapture,
} from './ExportRenderSessionImpl';
import {
  collectRenderableExportClipsInRange,
  preloadGaussianSplatsForExport,
  preload3DAssetsForExport,
} from './preloadGaussianSplats';
import {
  RESOLUTION_PRESETS,
  FRAME_RATE_PRESETS,
  CONTAINER_FORMATS,
  getVideoCodecsForContainer,
  getRecommendedBitrate,
  BITRATE_RANGE,
  formatBitrate,
  checkCodecSupport,
} from './codecHelpers';
import {
  canRetainExportOutputSurface,
  canRetainExportRunJob,
  createExportRunId,
  releaseExportRunResources,
  reportExportClipStates,
  reportExportOutputSurface,
  reportExportParallelDecodeResources,
  reportExportRunJob,
} from '../../services/timeline/exportRuntimeReporting';
import type { TimelineRuntimeAdmissionDecision } from '../../services/timeline/runtimeCoordinatorTypes';
import { ExportPreviewPublisher } from './frameExporter/ExportPreviewPublisher';
import { prepareTransitionCompositionsForExport } from './prepareTransitionCompositionsForExport';

export class FrameExporter {
  private static readonly PREVIEW_FRAME_INTERVAL_MS = 0;
  private static readonly RUNTIME_REPORT_INTERVAL_MS = 1000;

  private settings: FullExportSettings;
  private encoder: VideoEncoderWrapper | null = null;
  private audioPipeline: AudioExportPipeline | null = null;
  private isCancelled = false;
  private frameTimes: number[] = [];
  private clipStates: Map<string, ExportClipState> = new Map();
  private exportMode: ExportMode;
  private parallelDecoder: ParallelDecodeManager | null = null;
  private useParallelDecode = false;
  private lastExportRuntimeReportMs = Number.NEGATIVE_INFINITY;
  private activeExportRunId: string | null = null;
  private renderSession: ExportRenderSessionImpl | null = null;
  private previewPublisher: ExportPreviewPublisher;

  constructor(settings: FullExportSettings) {
    this.settings = settings;
    this.exportMode = settings.exportMode ?? 'fast';
    this.previewPublisher = new ExportPreviewPublisher(
      FrameExporter.PREVIEW_FRAME_INTERVAL_MS,
      () => this.activeExportRunId,
      (stage, decision) => this.logSoftAdmissionDenial(stage, decision),
    );
  }

  private createAdmissionError(
    stage: string,
    decision: TimelineRuntimeAdmissionDecision
  ): Error {
    const rejectedUnits = decision.rejectedUnits
      .map((entry) => `${entry.unit}:${entry.used}/${entry.limit ?? 'unbounded'}`)
      .join(', ');
    const error = new Error(
      `Export ${stage} denied by runtime admission: ${decision.reason ?? 'unknown'}${
        rejectedUnits ? ` (${rejectedUnits})` : ''
      }`
    );
    Object.assign(error, { admissionDecision: decision });
    return error;
  }

  private logSoftAdmissionDenial(stage: string, decision: TimelineRuntimeAdmissionDecision): void {
    log.debug(`Export ${stage} skipped by runtime admission`, {
      resourceId: decision.resourceId,
      reason: decision.reason,
      rejectedUnits: decision.rejectedUnits.map((entry) => entry.unit),
    });
  }

  private abortExportSetup(
    runId: string,
    error: unknown,
    renderSession?: ExportRenderSessionImpl
  ): void {
    this.encoder?.cancel();
    this.audioPipeline?.cancel();
    renderSession?.dispose();
    if (this.renderSession === renderSession) {
      this.renderSession = null;
    }
    exportDiagnostics.finish('failed', error);
    releaseExportRunResources(runId);
    if (this.activeExportRunId === runId) {
      this.activeExportRunId = null;
    }
    this.encoder = null;
    this.audioPipeline = null;
  }

  private resetAttemptState(): void {
    this.encoder = null;
    this.audioPipeline = null;
    this.frameTimes = [];
    this.clipStates.clear();
    this.parallelDecoder = null;
    this.useParallelDecode = false;
    this.lastExportRuntimeReportMs = Number.NEGATIVE_INFINITY;
    this.activeExportRunId = null;
    this.renderSession = null;
  }

  private shouldForcePreciseRendering(): boolean {
    const state = useTimelineStore.getState();
    const clipsInRange = collectRenderableExportClipsInRange(
      this.settings.startTime,
      this.settings.endTime,
      Array.isArray(state.tracks) ? state.tracks : [],
      Array.isArray(state.clips) ? state.clips : [],
    );

    return clipsInRange.some((clip) =>
      clip.source?.type === 'gaussian-splat' ||
      (
        clip.is3D === true &&
        clip.source?.type !== 'video' &&
        clip.source?.type !== 'camera' &&
        clip.source?.type !== 'splat-effector'
      )
    );
  }

  async export(onProgress: (progress: ExportProgress) => void): Promise<Blob | null> {
    const forcePreciseRendering = this.shouldForcePreciseRendering();
    const initialMode = forcePreciseRendering ? 'precise' : this.exportMode;

    if (forcePreciseRendering && this.exportMode !== 'precise') {
      log.info('Forcing PRECISE export mode for 3D and gaussian splat content');
    }

    this.exportMode = initialMode;
    this.resetAttemptState();

    try {
      return await this.exportAttempt(onProgress);
    } catch (error) {
      log.error('Export error:', error);
      throw error;
    }
  }

  private async exportAttempt(onProgress: (progress: ExportProgress) => void): Promise<Blob | null> {
    const { fps, startTime, endTime, width, height, includeAudio } = this.settings;
    const frameDuration = 1 / fps;
    const totalFrames = Math.ceil((endTime - startTime) * fps);
    const state = useTimelineStore.getState();
    const tracks = Array.isArray(state.tracks) ? state.tracks : [];
    const clips = Array.isArray(state.clips) ? state.clips : [];
    const requestedAudio = !!includeAudio;
    const audioClipsInRange = requestedAudio
      ? AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime, state.masterAudioState)
      : [];
    const shouldExportAudio = requestedAudio && audioClipsInRange.length > 0;
    const clipsInRange = collectRenderableExportClipsInRange(startTime, endTime, tracks, clips);
    const hasGaussianSplatsInRange = clipsInRange.some((clip) =>
      clip.source?.type === 'gaussian-splat',
    );
    const has3DAssetsInRange = clipsInRange.some((clip) =>
      clip.is3D === true &&
      clip.source?.type !== 'video' &&
      clip.source?.type !== 'gaussian-splat' &&
      clip.source?.type !== 'camera' &&
      clip.source?.type !== 'splat-effector'
    );
    const exportRunId = createExportRunId();
    const startedAtMs = Date.now();
    const runJobReport = {
      runId: exportRunId,
      settings: this.settings,
      totalFrames,
      startedAtMs,
      exportMode: this.exportMode,
      requestedAudio,
      effectiveAudio: shouldExportAudio,
    };
    const runJobAdmission = canRetainExportRunJob(runJobReport);
    if (!runJobAdmission.admitted) {
      throw this.createAdmissionError('run job', runJobAdmission);
    }
    this.activeExportRunId = exportRunId;

    // For stacked alpha, the encoded video is double height (RGB top + alpha bottom)
    const encodedHeight = this.settings.stackedAlpha ? height * 2 : height;

    exportDiagnostics.start({
      width,
      height: encodedHeight,
      fps,
      totalFrames,
      startTime,
      endTime,
      exportMode: this.exportMode,
      requestedAudio,
      stackedAlpha: !!this.settings.stackedAlpha,
      codec: this.settings.codec,
      container: this.settings.container,
    });
    exportDiagnostics.annotate({
      requestedAudio,
      effectiveAudio: shouldExportAudio,
      audioClipCount: audioClipsInRange.length,
      renderableClipCount: clipsInRange.length,
      skippedAudioReason: requestedAudio && !shouldExportAudio
        ? 'no unmuted audio clips or mixdowns in export range'
        : undefined,
    });

    if (requestedAudio && !shouldExportAudio) {
      log.info('Audio export skipped: no unmuted audio clips or mixdowns in export range');
    }

    log.info(`Starting export: ${width}x${encodedHeight} @ ${fps}fps, ${totalFrames} frames, audio: ${shouldExportAudio ? 'yes' : 'no'}${this.settings.stackedAlpha ? ', stacked alpha' : ''}`);
    reportExportRunJob(runJobReport);

    // Initialize encoder (with doubled height for stacked alpha)
    this.encoder = new VideoEncoderWrapper({ ...this.settings, height: encodedHeight, includeAudio: shouldExportAudio });
    const encoderInitStart = performance.now();
    let initialized = false;
    try {
      initialized = await this.encoder.init();
    } catch (error) {
      exportDiagnostics.recordPhase('encoderInit', performance.now() - encoderInitStart);
      exportDiagnostics.finish('failed', error);
      throw error;
    }
    exportDiagnostics.recordPhase('encoderInit', performance.now() - encoderInitStart);
    if (!initialized) {
      const error = new Error('Failed to initialize encoder');
      log.error(error.message);
      exportDiagnostics.finish('failed', error);
      return null;
    }

    // Initialize audio pipeline
    if (shouldExportAudio) {
      this.audioPipeline = new AudioExportPipeline({
        sampleRate: this.settings.audioSampleRate ?? 48000,
        bitrate: this.settings.audioBitrate ?? 256000,
        normalize: this.settings.normalizeAudio ?? false,
      }, {
        exportRunId,
      });
    }

    const zeroCopySurfaceReport = {
      runId: exportRunId,
      width,
      height,
      zeroCopy: true,
      stackedAlpha: this.settings.stackedAlpha,
    };
    const readbackSurfaceReport = {
      runId: exportRunId,
      width,
      height,
      zeroCopy: false,
      stackedAlpha: this.settings.stackedAlpha,
    };
    const zeroCopySurfaceAdmission = canRetainExportOutputSurface(zeroCopySurfaceReport);
    const readbackSurfaceAdmission = canRetainExportOutputSurface(readbackSurfaceReport);
    if (!zeroCopySurfaceAdmission.admitted && !readbackSurfaceAdmission.admitted) {
      const error = this.createAdmissionError('output surface', zeroCopySurfaceAdmission);
      this.abortExportSetup(exportRunId, error);
      throw error;
    }

    const renderSession = new ExportRenderSessionImpl({
      runId: exportRunId,
      width,
      height,
      stackedAlpha: !!this.settings.stackedAlpha,
      preferZeroCopy: zeroCopySurfaceAdmission.admitted,
    });
    this.renderSession = renderSession;
    try {
      await renderSession.begin();
    } catch (error) {
      this.abortExportSetup(exportRunId, error, renderSession);
      throw error;
    }

    const useZeroCopy = renderSession.usesZeroCopy;
    if (!useZeroCopy && !readbackSurfaceAdmission.admitted) {
      const error = this.createAdmissionError('readback output surface', readbackSurfaceAdmission);
      this.abortExportSetup(exportRunId, error, renderSession);
      throw error;
    }
    reportExportOutputSurface(useZeroCopy ? zeroCopySurfaceReport : readbackSurfaceReport);
    if (useZeroCopy) {
      if (hasGaussianSplatsInRange || has3DAssetsInRange) {
        log.info('Complex 3D export detected, using zero-copy export canvas path');
      } else {
        log.info('Using zero-copy export path (OffscreenCanvas -> VideoFrame)');
      }
    } else {
      log.info('Falling back to readPixels export path');
    }

    let completed = false;
    let finalStatus: 'success' | 'failed' | 'cancelled' = 'failed';
    let finalError: unknown;
    try {
      // Prepare clips for export
      const prepareStart = performance.now();
      const preparation = await prepareClipsForExport(this.settings, this.exportMode, exportRunId);
      exportDiagnostics.recordPhase('prepare', performance.now() - prepareStart);
      this.clipStates = preparation.clipStates;
      this.parallelDecoder = preparation.parallelDecoder;
      this.useParallelDecode = preparation.useParallelDecode;
      this.exportMode = preparation.exportMode;
      reportExportClipStates(exportRunId, this.clipStates);
      this.reportExportRuntimeState(exportRunId, true);
      await prepareTransitionCompositionsForExport();

      // Initialize layer builder cache (tracks don't change during export)
      initializeLayerBuilder(tracks);
      if (has3DAssetsInRange) {
        const preload3DStart = performance.now();
        await preload3DAssetsForExport({
          startTime: this.settings.startTime,
          endTime: this.settings.endTime,
          width,
          height,
        });
        exportDiagnostics.recordPhase('preload3D', performance.now() - preload3DStart);
      }
      const preloadSplatsStart = performance.now();
      await preloadGaussianSplatsForExport({
        startTime: this.settings.startTime,
        endTime: this.settings.endTime,
      });
      exportDiagnostics.recordPhase('preloadSplats', performance.now() - preloadSplatsStart);

      // Pre-calculate frame tolerance
      const frameTolerance = getFrameTolerance(fps);
      const keyframeInterval = getKeyframeInterval(fps);
      let previousClipSignature: string | null = null;

      // Audio is independent of the rendered video frames, so kick off the whole
      // audio pipeline now and let it run in parallel with the video loop instead
      // of as a serial phase afterwards. Its progress is surfaced in the video
      // progress reports; the result is awaited once the frames are done.
      let audioExportPromise: Promise<EncodedAudioResult | null> | null = null;
      let latestAudioPhase: ExportProgress['audioPhase'];
      let latestAudioPercent = 0;
      let audioDone = false;
      let audioError: unknown = null;
      if (shouldExportAudio && this.audioPipeline) {
        log.info('Starting audio export (parallel with video)...');
        const audioStart = performance.now();
        audioExportPromise = this.audioPipeline
          .exportAudio(startTime, endTime, (audioProgress) => {
            if (this.isCancelled) return;
            latestAudioPhase = audioProgress.phase;
            latestAudioPercent = audioProgress.percent;
          })
          .catch((err) => { audioError = err; return null; })
          .finally(() => {
            audioDone = true;
            exportDiagnostics.recordPhase('audio', performance.now() - audioStart);
          });
      }

      // Phase 1: Encode video frames
      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.isCancelled) {
          log.info('Export cancelled');
          this.encoder.cancel();
          this.audioPipeline?.cancel();
          finalStatus = 'cancelled';
          return null;
        }

        const frameStart = performance.now();
        const time = startTime + frame * frameDuration;

        // Create FrameContext once per frame - avoids repeated getState() calls
        const ctx = this.createFrameContext(time, fps, frameTolerance);
        const activeVideoClips = ctx.clipsAtTime.filter((clip) => {
          const track = ctx.trackMap.get(clip.trackId);
          return track?.visible && clip.source?.type === 'video';
        });
        const activeClipIds = activeVideoClips.map((clip) => clip.id).sort();
        const activeClipNames = activeVideoClips.map((clip) => clip.name);
        const clipSignature = activeClipIds.join('|');
        const cutBoundary = previousClipSignature !== null && clipSignature !== previousClipSignature;
        previousClipSignature = clipSignature;

        if (frame % 30 === 0 || frame < 5) {
          log.debug(`Processing frame ${frame}/${totalFrames} at time ${time.toFixed(3)}s`);
        }

        const seekStart = performance.now();
        await seekAllClipsToTime(ctx, this.clipStates, this.parallelDecoder, this.useParallelDecode);
        const seekMs = performance.now() - seekStart;
        this.reportExportRuntimeState(exportRunId);

        const waitStart = performance.now();
        await waitForAllVideosReady(ctx, this.clipStates, this.parallelDecoder, this.useParallelDecode);
        const waitMs = performance.now() - waitStart;

        const buildLayersStart = performance.now();
        const layers = buildLayersAtTime(ctx, this.clipStates, this.parallelDecoder, this.useParallelDecode);
        const buildLayersMs = performance.now() - buildLayersStart;

        if (layers.length === 0 && frame === 0) {
          log.warn(`No layers at time ${time}`);
        }

        // Calculate timestamp and duration in microseconds
        const timestampMicros = Math.round(frame * (1_000_000 / fps));
        const durationMicros = Math.round(1_000_000 / fps);

        let capture: ExportRenderSessionFrameCapture;
        try {
          capture = await renderSession.renderFrame({
            time,
            layers,
            timestampMicros,
            durationMicros,
          });
        } catch (error) {
          if (error instanceof ExportFrameCaptureUnavailableError) {
            if (error.captureKind === 'video-frame') {
              log.error(`Failed to create VideoFrame at frame ${frame}`);
            } else {
              log.error(`Failed to read pixels at frame ${frame}`);
            }
            throw new Error(`Export frame capture failed at frame ${frame} (${error.captureKind})`);
          }
          throw error;
        }
        const { maskSyncMs, ensureLayersMs, renderMs, captureMs } = capture.metrics;

        let encodeMs = 0;
        if (capture.kind === 'video-frame') {
          const videoFrame = capture.frame;
          this.previewPublisher.publishFrame(videoFrame, time);
          const encodeStart = performance.now();
          await this.encoder.encodeVideoFrame(videoFrame, frame, keyframeInterval);
          encodeMs = performance.now() - encodeStart;
          videoFrame.close();
        } else {
          const pixels = capture.pixels;
          this.previewPublisher.publishPixels(pixels, width, height, time);
          const encodeStart = performance.now();
          await this.encoder.encodeFrame(pixels, frame, keyframeInterval);
          encodeMs = performance.now() - encodeStart;
        }

        // Early cancellation check after expensive encode
        if (this.isCancelled) {
          finalStatus = 'cancelled';
          return null;
        }

        // Update progress
        const frameTime = performance.now() - frameStart;
        exportDiagnostics.recordFrame({
          frame: frame + 1,
          time,
          totalMs: frameTime,
          seekMs,
          waitMs,
          buildLayersMs,
          maskSyncMs,
          ensureLayersMs,
          renderMs,
          captureMs,
          encodeMs,
          layerCount: layers.length,
          activeClipIds,
          activeClipNames,
          cutBoundary,
        });
        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > 30) this.frameTimes.shift();

        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const remainingFrames = totalFrames - frame - 1;
        const videoWeight = shouldExportAudio ? 0.95 : 1.0;
        const videoPercent = ((frame + 1) / totalFrames) * 100 * videoWeight;

        const progress: ExportProgress = {
          phase: 'video',
          currentFrame: frame + 1,
          totalFrames,
          percent: videoPercent,
          estimatedTimeRemaining: (remainingFrames * avgFrameTime) / 1000,
          currentTime: time,
          ...(audioExportPromise ? { audioPhase: latestAudioPhase, audioPercent: latestAudioPercent } : {}),
        };
        exportDiagnostics.updateProgress(progress);
        onProgress(progress);
      }

      // Phase 2: Await the parallel audio export (usually already finished while
      // the video frames were encoding) and attach the chunks before muxing.
      let audioResult: EncodedAudioResult | null = null;
      if (audioExportPromise) {
        if (this.isCancelled) {
          this.audioPipeline?.cancel();
          finalStatus = 'cancelled';
          return null;
        }
        if (!audioDone) {
          onProgress({
            phase: 'audio',
            currentFrame: totalFrames,
            totalFrames,
            percent: 96,
            estimatedTimeRemaining: 0,
            currentTime: endTime,
            audioPhase: latestAudioPhase ?? 'processing',
            audioPercent: latestAudioPercent,
          });
        }
        audioResult = await audioExportPromise;
        if (audioError) {
          throw audioError instanceof Error ? audioError : new Error(String(audioError));
        }
        if (audioResult && audioResult.chunks.length > 0) {
          this.encoder.addAudioChunks(audioResult);
        } else {
          log.debug('No audio to add');
        }
      }

      const muxStart = performance.now();
      const blob = await this.encoder.finish();
      exportDiagnostics.recordPhase('mux', performance.now() - muxStart);
      completed = true;
      finalStatus = 'success';
      log.info(`Export complete: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
      return blob;
    } catch (error) {
      finalError = error;
      finalStatus = this.isCancelled ? 'cancelled' : 'failed';
      throw error;
    } finally {
      if (!completed) {
        this.encoder?.cancel();
        this.audioPipeline?.cancel();
      }
      const cleanupStart = performance.now();
      this.cleanup(renderSession);
      exportDiagnostics.recordPhase('cleanup', performance.now() - cleanupStart);
      exportDiagnostics.finish(finalStatus, finalError);
      releaseExportRunResources(exportRunId);
      if (this.activeExportRunId === exportRunId) {
        this.activeExportRunId = null;
      }
      this.encoder = null;
      this.audioPipeline = null;
      this.renderSession = null;
    }
  }

  cancel(): void {
    this.isCancelled = true;
    this.renderSession?.cancel('FrameExporter cancelled');
    this.audioPipeline?.cancel();
    cleanupExportMode(this.clipStates, this.parallelDecoder);
    if (this.activeExportRunId) {
      releaseExportRunResources(this.activeExportRunId);
      this.activeExportRunId = null;
    }
  }

  private reportExportRuntimeState(runId: string, force = false): void {
    if (!this.useParallelDecode || !this.parallelDecoder) {
      return;
    }

    const now = performance.now();
    if (!force && now - this.lastExportRuntimeReportMs < FrameExporter.RUNTIME_REPORT_INTERVAL_MS) {
      return;
    }

    this.lastExportRuntimeReportMs = now;
    reportExportParallelDecodeResources(
      runId,
      this.parallelDecoder.getRuntimeSnapshot(),
      this.clipStates
    );
  }

  private cleanup(renderSession: ExportRenderSessionImpl): void {
    cleanupExportMode(this.clipStates, this.parallelDecoder);
    cleanupLayerBuilder();
    this.parallelDecoder = null;
    this.useParallelDecode = false;
    renderSession.dispose();
  }

  /**
   * Create FrameContext for a single frame - caches all state lookups.
   * This is the key optimization: one getState() call per frame instead of 5+.
   */
  private createFrameContext(time: number, fps: number, frameTolerance: number): FrameContext {
    const state = useTimelineStore.getState();
    const getMediaDuration = createTimelineTransitionMediaDurationResolver();
    const clipsAtTime = state.getClipsAtTime(time);

    // Build O(1) lookup maps
    const trackMap = new Map(state.tracks.map(t => [t.id, t]));
    const clipsByTrack = new Map(clipsAtTime.map(c => [c.trackId, c]));
    const transitionParticipantsByTrack = new Map<string, ActiveTransitionPlan>();
    const renderClipsById = new Map(clipsAtTime.map(c => [c.id, c]));

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
      const outgoingSourceClip = createTransitionSourceClip(
        transition.outgoingClip,
        transition.plan.outgoing,
        time
      );
      const incomingSourceClip = createTransitionSourceClip(
        transition.incomingClip,
        transition.plan.incoming,
        time
      );
      renderClipsById.set(outgoingSourceClip.id, outgoingSourceClip);
      renderClipsById.set(incomingSourceClip.id, incomingSourceClip);
    }
    const renderClipsAtTime = Array.from(renderClipsById.values());

    return {
      time,
      fps,
      frameTolerance,
      outputWidth: this.settings.width,
      outputHeight: this.settings.height,
      clipsAtTime,
      renderClipsAtTime,
      trackMap,
      clipsByTrack,
      transitionParticipantsByTrack,
      getInterpolatedTransform: state.getInterpolatedTransform,
      getInterpolatedEffects: state.getInterpolatedEffects,
      getInterpolatedColorCorrection: state.getInterpolatedColorCorrection,
      getInterpolatedVectorAnimationSettings: state.getInterpolatedVectorAnimationSettings,
      getInterpolatedTextBounds: state.getInterpolatedTextBounds,
      getSourceTimeForClip: state.getSourceTimeForClip,
      getInterpolatedSpeed: state.getInterpolatedSpeed,
    };
  }

  // Static helper methods - delegate to codecHelpers
  static isSupported(): boolean {
    return 'VideoEncoder' in window && 'VideoFrame' in window;
  }

  static getPresetResolutions() {
    return RESOLUTION_PRESETS;
  }

  static getPresetFrameRates() {
    return FRAME_RATE_PRESETS;
  }

  static getRecommendedBitrate(width: number, _height: number, _fps: number): number {
    return getRecommendedBitrate(width);
  }

  static getContainerFormats() {
    return CONTAINER_FORMATS;
  }

  static getVideoCodecs(container: 'mp4' | 'webm') {
    return getVideoCodecsForContainer(container);
  }

  static async checkCodecSupport(codec: 'h264' | 'h265' | 'vp9' | 'av1', width: number, height: number): Promise<boolean> {
    return checkCodecSupport(codec, width, height);
  }

  static getBitrateRange() {
    return BITRATE_RANGE;
  }

  static formatBitrate(bitrate: number): string {
    return formatBitrate(bitrate);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
