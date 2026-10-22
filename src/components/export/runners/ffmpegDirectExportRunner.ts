import { AudioExportPipeline } from '../../../engine/audio';
import {
  FFmpegExportCancelledError,
  FFmpegExportMemoryError,
  getFFmpegBridge,
  type FFmpegFrameStream,
  isAllocationFailure,
  type DnxhrProfile,
  type FFmpegContainer,
  type FFmpegExportSettings,
  type FFmpegProgress,
  type FFmpegVideoCodec,
  type ProResProfile,
} from '../../../engine/ffmpeg';
import { ExportFrameCaptureUnavailableError } from '../../../engine/export/ExportRenderSessionImpl';
import type { GifDither, GifLoopMode, GifPaletteMode } from '../../../engine/gif/gifOptions';
import { Logger } from '../../../services/logger';
import { createExportRunId } from '../../../services/timeline/exportRuntimeReporting';
import { useTimelineStore } from '../../../stores/timeline';
import { FFmpegFrameRenderer } from '../exportHelpers';
import {
  attachRenderSession,
  disposeRenderSession,
  forceOpaqueAlpha,
  getReadbackPixels,
  type ExportRenderSessionFactory,
  type ExportRenderSessionRef,
} from './runnerUtils';

const log = Logger.create('FfmpegDirectExportRunner');

export interface FfmpegDirectExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  filename: string;
  visualMode: string;
  includeAudio: boolean;
  audioSampleRate: number;
  audioBitrate: number;
  normalizeAudio: boolean;
  includeAlpha: boolean;
  ffmpegCodec: FFmpegVideoCodec;
  ffmpegContainer: FFmpegContainer;
  ffmpegQuality: number;
  proresProfile: ProResProfile;
  dnxhrProfile: DnxhrProfile;
  gifColors: number;
  gifDither: GifDither;
  gifLoop: GifLoopMode;
  gifLoopCount: number;
  gifPaletteMode: GifPaletteMode;
  gifOptimize: boolean;
  gifTransparency: boolean;
  gifAlphaThreshold: number;
  gifBayerScale: number;
  frameRendererRef: { current: FFmpegFrameRenderer | null };
  audioPipelineRef: { current: AudioExportPipeline | null };
  renderSessionRef: ExportRenderSessionRef;
  createRenderSession: ExportRenderSessionFactory;
  onFfmpegProgress: (progress: FFmpegProgress) => void;
  onTimelineProgress: (percent: number, time: number) => void;
  onPhase: (phase: 'idle' | 'rendering' | 'audio' | 'encoding') => void;
}

export interface FfmpegDirectExportRunnerResult {
  blob: Blob;
  filename: string;
}

export async function runFfmpegDirectExport(
  input: FfmpegDirectExportRunnerInput,
): Promise<FfmpegDirectExportRunnerResult | null> {
  const exportAsGif = input.visualMode === 'gif';
  const timelineState = useTimelineStore.getState();
  const shouldIncludeAudio = input.includeAudio && !exportAsGif && AudioExportPipeline.hasAudioInRange(
    Array.isArray(timelineState.clips) ? timelineState.clips : [],
    Array.isArray(timelineState.tracks) ? timelineState.tracks : [],
    input.startTime,
    input.endTime,
    timelineState.masterAudioState,
  );
  const ffmpegFrameRenderer = new FFmpegFrameRenderer({
    width: input.width,
    height: input.height,
    fps: input.fps,
    startTime: input.startTime,
    endTime: input.endTime,
    runtimeReporting: true,
    runtimeExportKind: exportAsGif ? 'ffmpeg-gif' : 'ffmpeg-video',
    includeAudio: shouldIncludeAudio,
  });
  input.frameRendererRef.current = ffmpegFrameRenderer;
  let renderSession: ReturnType<ExportRenderSessionFactory> | null = null;
  let frameStream: FFmpegFrameStream | null = null;

  try {
    await ffmpegFrameRenderer.initialize();

    const settings: FFmpegExportSettings = {
      codec: exportAsGif ? 'gif' : input.ffmpegCodec,
      container: exportAsGif ? 'gif' : input.ffmpegContainer,
      width: input.width,
      height: input.height,
      fps: input.fps,
      startTime: input.startTime,
      endTime: input.endTime,
      quality: !exportAsGif && input.ffmpegCodec === 'mjpeg' ? input.ffmpegQuality : undefined,
      bitrate: undefined,
      proresProfile: !exportAsGif && input.ffmpegCodec === 'prores' ? input.proresProfile : undefined,
      dnxhrProfile: !exportAsGif && input.ffmpegCodec === 'dnxhd' ? input.dnxhrProfile : undefined,
      pixelFormat: !exportAsGif && input.ffmpegCodec === 'ffv1' && input.includeAlpha
        ? 'yuva444p10le'
        : undefined,
      gifColors: input.gifColors,
      gifDither: input.gifDither,
      gifLoop: input.gifLoop,
      gifLoopCount: input.gifLoopCount,
      gifPaletteMode: input.gifPaletteMode,
      gifOptimize: input.gifOptimize,
      gifTransparency: input.gifTransparency,
      gifAlphaThreshold: input.gifAlphaThreshold,
      gifBayerScale: input.gifBayerScale,
    };

    log.info('Rendering frames for FFmpeg...');
    const totalFrames = Math.ceil((input.endTime - input.startTime) * input.fps);
    const frameDuration = 1 / input.fps;

    log.info(`Total frames: ${totalFrames}, duration: ${frameDuration.toFixed(4)}s per frame`);

    // Frames stream into FFmpeg in bounded segments: raw memory stays at one
    // segment however long the range is, and cancel() takes effect at the
    // next segment instead of after the whole encode.
    const ffmpeg = getFFmpegBridge();
    frameStream = await ffmpeg.openFrameStream(settings, totalFrames);
    const stream = frameStream;

    renderSession = input.createRenderSession({
      runId: ffmpegFrameRenderer.getRuntimeRunId() ?? createExportRunId(),
      width: input.width,
      height: input.height,
      stackedAlpha: false,
      preferZeroCopy: false,
    });
    attachRenderSession(input.renderSessionRef, renderSession);

    const frameStartTime = performance.now();

    try {
      await renderSession.begin();

      for (let i = 0; i < totalFrames; i++) {
        if (ffmpegFrameRenderer.isCancelled()) {
          log.info('FFmpeg export cancelled during frame rendering');
          return null;
        }

        if (ffmpegFrameRenderer.shouldFinishEarly() && stream.frameCount > 0) break;
        const time = input.startTime + i * frameDuration;

        if (i === 0) log.debug('Frame 0: Building layers...');

        const layers = await ffmpegFrameRenderer.buildLayersAtTime(time);

        if (i === 0) log.debug(`Frame 0: Got ${layers.length} layers`);

        if (layers.length === 0) {
          log.warn(`No layers at time ${time.toFixed(3)}`);
        }

        if (i === 0) log.debug('Frame 0: Render complete, reading pixels...');

        let pixels: Uint8ClampedArray | null = null;
        try {
          const capture = await renderSession.renderFrame({
            time,
            layers,
          });
          pixels = getReadbackPixels(capture);
        } catch (renderError) {
          if (ffmpegFrameRenderer.isCancelled()) {
            log.info('FFmpeg export cancelled after frame render');
            return null;
          }
          if (
            renderError instanceof ExportFrameCaptureUnavailableError &&
            renderError.captureKind === 'rgba-pixels'
          ) {
            if (i === 0) log.debug('Frame 0: Got pixels: null');
            continue;
          }
          throw renderError;
        }

        if (ffmpegFrameRenderer.isCancelled()) {
          log.info('FFmpeg export cancelled after frame render');
          return null;
        }

        if (i === 0) log.debug(`Frame 0: Got pixels: ${pixels ? pixels.length : 'null'}`);
        const frameSlot = stream.writeFrame(pixels);
        if (!input.includeAlpha) forceOpaqueAlpha(frameSlot);

        if (i < 3 || i % 30 === 0) {
          const sample = [pixels[0], pixels[1], pixels[2], pixels[3], pixels[1000], pixels[2000]];
          log.debug(`Frame ${i} sample pixels: [${sample.join(', ')}]`);
        }

        if (i === 0 || i % 30 === 0) {
          const elapsed = (performance.now() - frameStartTime) / 1000;
          const renderFps = (i + 1) / elapsed;
          log.debug(`Frame ${i + 1}/${totalFrames} at ${time.toFixed(3)}s, ${renderFps.toFixed(1)} fps, ${layers.length} layers`);
        }

        const percent = ((i + 1) / totalFrames) * 85;
        input.onFfmpegProgress({
          percent,
          frame: i + 1,
          fps: 0,
          time,
          speed: 0,
          bitrate: 0,
          size: 0,
          eta: 0,
        });
        input.onTimelineProgress(percent, time);
      }
    } finally {
      renderSession = disposeRenderSession(input.renderSessionRef, renderSession);
    }

    if (stream.frameCount === 0) {
      throw new Error('No frames rendered');
    }
    settings.endTime = Math.min(input.endTime, input.startTime + stream.frameCount / input.fps);

    let audioBuffer: AudioBuffer | null = null;

    if (input.includeAudio && !exportAsGif && !shouldIncludeAudio) {
      log.info('FFmpeg audio export skipped: no unmuted audio clips or mixdowns in export range');
    }

    if (shouldIncludeAudio) {
      input.onPhase('audio');
      log.info('Extracting audio for FFmpeg...');

      try {
        const audioPipeline = new AudioExportPipeline({
          sampleRate: input.audioSampleRate,
          bitrate: input.audioBitrate,
          normalize: input.normalizeAudio,
        }, {
          exportRunId: ffmpegFrameRenderer.getRuntimeRunId() ?? undefined,
        });
        input.audioPipelineRef.current = audioPipeline;

        audioBuffer = await audioPipeline.exportRawAudio(
          input.startTime,
          Math.min(input.endTime, input.startTime + stream.frameCount / input.fps),
          (audioProgress) => {
            const percent = 85 + (audioProgress.percent * 0.05);
            input.onFfmpegProgress({
              percent,
              frame: stream.frameCount,
              fps: 0,
              time: input.endTime,
              speed: 0,
              bitrate: 0,
              size: 0,
              eta: 0,
            });
            input.onTimelineProgress(percent, input.endTime);
          },
        );
        input.audioPipelineRef.current = null;

        if (audioBuffer && audioBuffer.length > 0) {
          log.info(`Audio extracted: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.length} samples`);
        } else {
          log.warn('Audio extraction returned empty or null buffer');
        }
      } catch (audioError) {
        log.warn('Audio extraction failed, continuing without audio', audioError);
      }
    }

    input.onPhase('encoding');
    log.info(`Joining ${stream.frameCount} encoded frames with FFmpeg...`);

    input.onFfmpegProgress({
      percent: 90,
      frame: stream.frameCount,
      fps: 0,
      time: input.endTime,
      speed: 0,
      bitrate: 0,
      size: 0,
      eta: 0,
    });
    input.onTimelineProgress(90, input.endTime);

    await new Promise(resolve => setTimeout(resolve, 50));

    if (ffmpegFrameRenderer.isCancelled()) {
      log.info('FFmpeg export cancelled before encoding');
      return null;
    }

    const blob = await stream.finish(audioBuffer, (progress: FFmpegProgress) => {
      const totalPercent = 90 + (progress.percent / 100) * 10;
      input.onFfmpegProgress({
        ...progress,
        percent: totalPercent,
      });
      input.onTimelineProgress(totalPercent, input.endTime);
    });

    log.info('FFmpeg export complete');
    return {
      blob,
      filename: `${input.filename}.${exportAsGif ? 'gif' : input.ffmpegContainer}`,
    };
  } catch (error) {
    if (ffmpegFrameRenderer.isCancelled() || error instanceof FFmpegExportCancelledError) {
      log.info('FFmpeg export cancelled');
      return null;
    }
    if (error instanceof FFmpegExportMemoryError) {
      // A memory limit of this machine, not a defect: tell the user what to change.
      log.warn('FFmpeg export ran out of memory', {
        stage: error.stage,
        requiredBytes: error.requiredBytes,
        frames: frameStream?.frameCount ?? 0,
        width: input.width,
        height: input.height,
      });
      throw error;
    }
    if (isAllocationFailure(error)) {
      // Not raised by the FFmpeg stream (e.g. frame readback): say so plainly
      // instead of blaming a raw buffer size that no longer exists.
      log.warn('Browser ran out of memory during FFmpeg export', error);
      throw new Error('The browser ran out of memory while rendering frames for the FFmpeg export. '
        + 'Close other tabs or apps, lower the resolution, or use the WebCodecs encoder.');
    }
    log.error('FFmpeg export error', error);
    throw error;
  } finally {
    frameStream?.abort();
    disposeRenderSession(input.renderSessionRef, renderSession);
    input.audioPipelineRef.current = null;
    ffmpegFrameRenderer.cleanup();
    input.frameRendererRef.current = null;
  }
}
