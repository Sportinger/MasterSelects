import { Logger } from '../../../services/logger';
import { checkBrowserGifExportSize, encodeBrowserGif } from '../../../engine/export/BrowserGifExporter';
import type { GifDither, GifLoopMode, GifPaletteMode } from '../../../engine/gif/gifOptions';
import { createExportRunId } from '../../../services/timeline/exportRuntimeReporting';
import { FFmpegFrameRenderer } from '../exportHelpers';
import {
  attachRenderSession,
  disposeRenderSession,
  getReadbackPixels,
  type ExportRenderSessionFactory,
  type ExportRenderSessionRef,
} from './runnerUtils';

const log = Logger.create('GifExportRunner');

export interface GifExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  exportMode: 'fast' | 'precise';
  filename: string;
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
  renderSessionRef: ExportRenderSessionRef;
  createRenderSession: ExportRenderSessionFactory;
  onProgress: (progress: {
    phase: 'video';
    currentFrame: number;
    totalFrames: number;
    percent: number;
    estimatedTimeRemaining: number;
    currentTime: number;
  }) => void;
  onTimelineProgress: (percent: number, time: number) => void;
}

export interface GifExportRunnerResult {
  blob: Blob;
  filename: string;
}

export async function runBrowserGifExport(
  input: GifExportRunnerInput,
): Promise<GifExportRunnerResult | null> {
  const preflight = checkBrowserGifExportSize({
    width: input.width,
    height: input.height,
    fps: input.fps,
    durationSeconds: Math.max(0, input.endTime - input.startTime),
    gifColors: input.gifColors,
    gifDither: input.gifDither,
    gifLoop: input.gifLoop,
    gifLoopCount: input.gifLoopCount,
    gifPaletteMode: input.gifPaletteMode,
    gifOptimize: input.gifOptimize,
    gifTransparency: input.gifTransparency,
    gifAlphaThreshold: input.gifAlphaThreshold,
    gifBayerScale: input.gifBayerScale,
  });
  if (!preflight.ok) {
    throw new Error(preflight.message ?? 'Browser GIF is too large for in-browser encoding.');
  }

  const frameRenderer = new FFmpegFrameRenderer({
    width: input.width,
    height: input.height,
    fps: input.fps,
    startTime: input.startTime,
    endTime: input.endTime,
    exportMode: input.exportMode,
    runtimeReporting: true,
    runtimeExportKind: 'browser-gif',
  });
  input.frameRendererRef.current = frameRenderer;
  let renderSession: ReturnType<ExportRenderSessionFactory> | null = null;

  try {
    await frameRenderer.initialize();

    const frames: Uint8Array[] = [];
    const totalFrames = Math.ceil((input.endTime - input.startTime) * input.fps);
    const frameDuration = 1 / input.fps;

    renderSession = input.createRenderSession({
      runId: frameRenderer.getRuntimeRunId() ?? createExportRunId(),
      width: input.width,
      height: input.height,
      stackedAlpha: false,
      preferZeroCopy: false,
    });
    attachRenderSession(input.renderSessionRef, renderSession);

    try {
      renderSession.begin();

      for (let i = 0; i < totalFrames; i++) {
        if (frameRenderer.isCancelled()) {
          return null;
        }

        const time = input.startTime + i * frameDuration;
        const layers = await frameRenderer.buildLayersAtTime(time);

        const capture = await renderSession.renderFrame({
          time,
          layers,
        });
        const pixels = getReadbackPixels(capture);

        const frameCopy = new Uint8Array(pixels.length);
        frameCopy.set(pixels);
        frames.push(frameCopy);

        const percent = ((i + 1) / totalFrames) * 60;
        input.onProgress({
          phase: 'video',
          currentFrame: i + 1,
          totalFrames,
          percent,
          estimatedTimeRemaining: 0,
          currentTime: time,
        });
        input.onTimelineProgress(percent, time);
      }
    } finally {
      renderSession = disposeRenderSession(input.renderSessionRef, renderSession);
    }

    if (frames.length === 0) {
      throw new Error('No frames rendered');
    }

    const blob = encodeBrowserGif(frames, {
      width: input.width,
      height: input.height,
      fps: input.fps,
      gifColors: input.gifColors,
      gifDither: input.gifDither,
      gifLoop: input.gifLoop,
      gifLoopCount: input.gifLoopCount,
      gifPaletteMode: input.gifPaletteMode,
      gifOptimize: input.gifOptimize,
      gifTransparency: input.gifTransparency,
      gifAlphaThreshold: input.gifAlphaThreshold,
      gifBayerScale: input.gifBayerScale,
    }, (gifProgress) => {
      const percent = 60 + (gifProgress.percent / 100) * 40;
      input.onProgress({
        phase: 'video',
        currentFrame: gifProgress.frame,
        totalFrames,
        percent,
        estimatedTimeRemaining: 0,
        currentTime: input.endTime,
      });
      input.onTimelineProgress(percent, input.endTime);
    });

    return {
      blob,
      filename: `${input.filename}.gif`,
    };
  } catch (error) {
    if (frameRenderer.isCancelled()) {
      log.info('Browser GIF export cancelled');
      return null;
    }
    log.error('Browser GIF export failed', error);
    throw error;
  } finally {
    disposeRenderSession(input.renderSessionRef, renderSession);
    frameRenderer.cleanup();
    input.frameRendererRef.current = null;
  }
}
