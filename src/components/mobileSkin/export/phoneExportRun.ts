// Runs one phone export spec through the editor's own export runners (the same ones the desktop
// export panel calls), connected to the timeline's linked media. The result is returned, never
// downloaded here: the sheet hands it to Share/Save. Cancel reaches whichever runner is active.
import { runAudioOnlyExport } from '../../export/runners/audioOnlyExportRunner';
import { runFfmpegDirectExport } from '../../export/runners/ffmpegDirectExportRunner';
import { runBrowserGifExport } from '../../export/runners/gifExportRunner';
import { runImageSequenceExport } from '../../export/runners/imageSequenceExportRunner';
import { runStillImageExport } from '../../export/runners/stillImageExportRunner';
import { runWebCodecsExport } from '../../export/runners/webCodecsExportRunner';
import type { ExportRenderSessionFactory, RunnerImageFormatOption } from '../../export/runners/runnerUtils';
import type { FFmpegFrameRenderer } from '../../export/exportHelpers';
import { IMAGE_FORMATS } from '../../export/exportSettingsState';
import type { AudioExportPipeline } from '../../../engine/audio';
import type { FrameExporter } from '../../../engine/export';
import { ExportRenderSessionImpl } from '../../../engine/export/ExportRenderSessionImpl';
import { getFFmpegBridge } from '../../../engine/ffmpeg';
import { withTimelineLinkedMedia } from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { useExportStore } from '../../../stores/exportStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { normalizeExportRenderQuality } from '../../../types/renderSettings';
import type { PhoneExportRunSpec } from './phoneExportAdvancedPlan';

export interface PhoneExportRunResult {
  blob: Blob;
  filename: string;
}

export interface PhoneExportRunHooks {
  filename: string;
  /** 0..1 */
  onProgress: (fraction: number) => void;
}

function fraction(percent: number): number {
  const value = percent / 100;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Cancel handle for one run; every runner registers what it needs to stop. */
export class PhoneExportRunHandle {
  readonly cancelledRef = { current: false };
  readonly frameRendererRef: { current: FFmpegFrameRenderer | null } = { current: null };
  readonly audioPipelineRef: { current: AudioExportPipeline | null } = { current: null };
  readonly renderSessionRef: { current: ExportRenderSessionImpl | null } = { current: null };
  exporter: FrameExporter | null = null;
  private usesFfmpeg = false;

  markFfmpeg(): void {
    this.usesFfmpeg = true;
  }

  /** Video kinds whose runner can stop after the current frame and still close a valid file. */
  static supportsFinishEarly(kind: PhoneExportRunSpec['kind']): boolean {
    return kind === 'webcodecs' || kind === 'ffmpeg';
  }

  /** Stops after the frame being rendered and finishes the file with what is done (the desktop "Finish file early"). */
  finishEarly(): boolean {
    if (!this.exporter && !this.frameRendererRef.current) return false;
    this.exporter?.finishEarly();
    this.frameRendererRef.current?.finishEarly();
    return true;
  }

  cancel(): void {
    this.cancelledRef.current = true;
    this.exporter?.cancel();
    this.frameRendererRef.current?.cancel();
    this.audioPipelineRef.current?.cancel();
    this.renderSessionRef.current?.cancel('Export cancelled');
    if (this.usesFfmpeg) getFFmpegBridge().cancel();
  }
}

function imageFormatOption(id: string): RunnerImageFormatOption {
  return IMAGE_FORMATS.find((format) => format.id === id) ?? IMAGE_FORMATS[0];
}

function createRenderSessionFactory(): ExportRenderSessionFactory {
  const compositionId = useMediaStore.getState().activeCompositionId ?? 'timeline:active';
  return (options) => new ExportRenderSessionImpl({ ...options, compositionId });
}

function timelineProgress(percent: number, time: number): void {
  useTimelineStore.getState().setExportProgress(percent, time);
}

/**
 * Runs `spec`; resolves null when cancelled. The caller owns the timeline export lock for the
 * ranged kinds (startExport/endExport), exactly like the desktop controller.
 */
export async function runPhoneExportSpec(
  spec: PhoneExportRunSpec,
  handle: PhoneExportRunHandle,
  hooks: PhoneExportRunHooks,
): Promise<PhoneExportRunResult | null> {
  const common = {
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    startTime: spec.startTime,
    endTime: spec.endTime,
    filename: hooks.filename,
  };
  const gif = useExportStore.getState().settings;

  switch (spec.kind) {
    case 'webcodecs':
      return withTimelineLinkedMedia(runWebCodecsExport, {
        ...common,
        videoCodec: spec.videoCodec,
        containerFormat: spec.container,
        bitrate: spec.bitrate,
        rateControl: spec.rateControl,
        stackedAlpha: false,
        includeAudio: spec.includeAudio,
        audioSampleRate: spec.audioSampleRate,
        audioBitrate: spec.audioBitrate,
        normalizeAudio: false,
        exportMode: 'fast',
        onExporter: (exporter) => {
          handle.exporter = exporter;
          if (handle.cancelledRef.current) exporter.cancel();
        },
        onProgress: (progress) => hooks.onProgress(fraction(progress.percent)),
        onTimelineProgress: timelineProgress,
        renderQuality: normalizeExportRenderQuality(gif.renderQuality),
      });
    case 'gif':
      return withTimelineLinkedMedia(runBrowserGifExport, {
        ...common,
        exportMode: 'fast',
        gifColors: gif.gifColors,
        gifDither: gif.gifDither,
        gifLoop: gif.gifLoop,
        gifLoopCount: gif.gifLoopCount,
        gifPaletteMode: gif.gifPaletteMode,
        gifOptimize: gif.gifOptimize,
        gifTransparency: gif.gifTransparency,
        gifAlphaThreshold: gif.gifAlphaThreshold,
        gifBayerScale: gif.gifBayerScale,
        frameRendererRef: handle.frameRendererRef,
        renderSessionRef: handle.renderSessionRef,
        createRenderSession: createRenderSessionFactory(),
        onProgress: (progress) => hooks.onProgress(fraction(progress.percent)),
        onTimelineProgress: timelineProgress,
      });
    case 'sequence': {
      const result = await withTimelineLinkedMedia(runImageSequenceExport, {
        ...common,
        exportMode: 'fast',
        imageFormat: spec.imageFormat,
        imageQuality: 0.92,
        selectedImageFormat: imageFormatOption(spec.imageFormat),
        frameRendererRef: handle.frameRendererRef,
        renderSessionRef: handle.renderSessionRef,
        createRenderSession: createRenderSessionFactory(),
        onTimelineStart: () => {},
        onProgress: (progress) => hooks.onProgress(fraction(progress.percent)),
        onTimelineProgress: timelineProgress,
      });
      if (!result) return null;
      if (result.kind === 'folder') {
        throw new Error(`The frames were written to the folder "${result.folderName}". There is no single file to share.`);
      }
      return { blob: result.blob, filename: result.filename };
    }
    case 'still':
      return withTimelineLinkedMedia(runStillImageExport, {
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
        exportTime: spec.exportTime,
        filename: hooks.filename,
        imageFormat: spec.imageFormat,
        imageQuality: 0.92,
        selectedImageFormat: imageFormatOption(spec.imageFormat),
        renderSessionRef: handle.renderSessionRef,
        createRenderSession: createRenderSessionFactory(),
      });
    case 'audio': {
      const result = await withTimelineLinkedMedia(runAudioOnlyExport, {
        ...common,
        encoder: 'webcodecs',
        videoCodec: 'h264',
        containerFormat: 'mp4',
        bitrate: 0,
        audioOnlyFormat: spec.audioFormat,
        audioSampleRate: spec.audioSampleRate,
        audioBitrate: spec.audioBitrate,
        normalizeAudio: false,
        audioPipelineRef: handle.audioPipelineRef,
        cancelledRef: handle.cancelledRef,
        onProgress: (progress) => hooks.onProgress(fraction(progress.audioPercent ?? progress.percent)),
        onTimelineProgress: timelineProgress,
        onTimelineStart: () => {},
      });
      if (result.kind === 'cancelled') return null;
      if (result.kind === 'error') throw new Error(result.message);
      return { blob: result.blob, filename: result.filename };
    }
    case 'ffmpeg': {
      handle.markFfmpeg();
      const bridge = getFFmpegBridge();
      if (!bridge.isLoaded()) await bridge.load();
      if (handle.cancelledRef.current) return null;
      return withTimelineLinkedMedia(runFfmpegDirectExport, {
        ...common,
        visualMode: 'video',
        includeAudio: spec.includeAudio,
        audioSampleRate: spec.audioSampleRate,
        audioBitrate: spec.audioBitrate,
        normalizeAudio: false,
        includeAlpha: false,
        ffmpegCodec: spec.ffmpegCodec,
        ffmpegContainer: 'mov',
        ffmpegQuality: gif.ffmpegQuality,
        proresProfile: spec.proresProfile,
        dnxhrProfile: gif.dnxhrProfile,
        gifColors: gif.gifColors,
        gifDither: gif.gifDither,
        gifLoop: gif.gifLoop,
        gifLoopCount: gif.gifLoopCount,
        gifPaletteMode: gif.gifPaletteMode,
        gifOptimize: gif.gifOptimize,
        gifTransparency: gif.gifTransparency,
        gifAlphaThreshold: gif.gifAlphaThreshold,
        gifBayerScale: gif.gifBayerScale,
        frameRendererRef: handle.frameRendererRef,
        audioPipelineRef: handle.audioPipelineRef,
        renderSessionRef: handle.renderSessionRef,
        createRenderSession: createRenderSessionFactory(),
        onFfmpegProgress: (progress) => hooks.onProgress(fraction(progress.percent)),
        onTimelineProgress: timelineProgress,
        onPhase: () => {},
      });
    }
  }
}
