import { useCallback, useRef } from 'react';
import { ExportSubmissionGate } from './ExportSubmissionGate';
import { Logger } from '../../services/logger';
import { downloadBlob } from '../../engine/export';
import type { AudioExportPipeline } from '../../engine/audio';
import { getFFmpegBridge } from '../../engine/ffmpeg';
import { ExportRenderSessionImpl } from '../../engine/export/ExportRenderSessionImpl';
import { useMediaStore, type Composition } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useExportStore } from '../../stores/exportStore';
import type { FFmpegFrameRenderer } from './exportHelpers';
import { resolveExportRange } from './exportRange';
import { supportsNativeVideoAlpha } from './exportAlphaSupport';
import type { useExportState } from './useExportState';
import { runAudioOnlyExport } from './runners/audioOnlyExportRunner';
import { runFcpxmlExport } from './runners/fcpxmlExportRunner';
import { runFfmpegDirectExport } from './runners/ffmpegDirectExportRunner';
import { runHapExport } from './runners/hapExportRunner';
import { runBrowserGifExport } from './runners/gifExportRunner';
import { runImageSequenceExport } from './runners/imageSequenceExportRunner';
import type { RunnerImageFormatOption } from './runners/runnerUtils';
import { runStillImageExport } from './runners/stillImageExportRunner';
import { runWebCodecsExport } from './runners/webCodecsExportRunner';
import { createStoryboardAnimaticExportFrameDecorator } from '../../services/storyboard/animatic/exportFrameDecorator';
import { resolveStoryboardExportGuard } from '../../services/storyboard/animatic/exportPolicy';
import type { StoryboardAnimaticRenderMode } from '../../services/storyboard/animatic/types';
import {
  beginExportAnalytics,
  bucketFps,
  bucketResolution,
  bucketTimelineDuration,
  cancelExportAnalytics,
  completeExportAnalytics,
  failExportAnalytics,
  type AnalyticsExportRun,
} from '../../services/productAnalytics';

const log = Logger.create('ExportRunController');

type ExportState = ReturnType<typeof useExportState>;

interface ExportRunControllerInput {
  exportState: ExportState;
  playheadPosition: number;
  startExport: (startTime: number, endTime: number) => void;
  setExportProgress: (percent: number, currentTime: number) => void;
  endExport: () => void;
  getActiveComposition: () => Composition | undefined;
  selectedImageFormat: RunnerImageFormatOption;
  isXmlMode: boolean;
  isImageMode: boolean;
  isImageSequenceMode: boolean;
  isGifMode: boolean;
  isWebCodecsEncoder: boolean;
  storyboardExportMode: Exclude<StoryboardAnimaticRenderMode, 'preview'>;
}

export function useExportRunController({
  exportState, playheadPosition, startExport, setExportProgress, endExport,
  getActiveComposition, selectedImageFormat, isXmlMode, isImageMode,
  isImageSequenceMode, isGifMode, isWebCodecsEncoder,
  storyboardExportMode,
}: ExportRunControllerInput) {
  const submissionGate = useRef(new ExportSubmissionGate()).current;
  const ffmpegFrameRendererRef = useRef<FFmpegFrameRenderer | null>(null);
  const ffmpegAudioPipelineRef = useRef<AudioExportPipeline | null>(null);
  const exportRenderSessionRef = useRef<ExportRenderSessionImpl | null>(null);
  const audioOnlyCancelledRef = useRef(false);
  const activeAnalyticsRunRef = useRef<AnalyticsExportRun | null>(null);
  const storyboardClips = useTimelineStore((state) => state.clips);
  const storyboardTracks = useTimelineStore((state) => state.tracks);
  const storyboardMediaFiles = useMediaStore((state) => state.files);
  const activeCompositionId = useMediaStore((state) => (
    state.activeCompositionId ?? 'timeline:active'
  ));

  const {
    encoder, width, height, customWidth, customHeight, useCustomResolution,
    fps, customFps, useCustomFps, filename, bitrate, containerFormat, videoCodec,
    rateControl, ffmpegCodec, ffmpegContainer, proresProfile, dnxhrProfile, hapFormat,
    ffmpegQuality, gifColors, gifDither, gifLoop, gifPaletteMode, gifOptimize,
    gifLoopCount, gifTransparency, gifAlphaThreshold, gifBayerScale,
    includeAlpha, stackedAlpha, includeAudio, audioOnlyFormat, audioSampleRate,
    audioBitrate, normalizeAudio, videoEnabled, visualMode, imageFormat, imageQuality,
    isExporting, setIsExporting, setProgress, setFfmpegProgress, setExportPhase,
    setError, exporter, setExporter, isFFmpegReady, loadFFmpeg,
  } = exportState;
  const preserveNativeAlpha = includeAlpha && supportsNativeVideoAlpha({
    encoder,
    ffmpegCodec,
    proresProfile,
    dnxhrProfile,
    hapFormat,
  });

  const getCurrentExportRange = useCallback(() => {
    const timelineState = useTimelineStore.getState();
    const exportSettings = useExportStore.getState().settings;
    return resolveExportRange(
      {
        duration: timelineState.duration,
        inPoint: timelineState.inPoint,
        outPoint: timelineState.outPoint,
      },
      exportSettings.useInOut,
    );
  }, []);

  const startAnalyticsRun = useCallback((input: {
    container: string;
    encoder: string;
    endTime: number;
    fps: number;
    height: number;
    kind: 'audio' | 'fcpxml' | 'gif' | 'image_sequence' | 'still' | 'video';
    startTime: number;
    width: number;
  }) => {
    const run = beginExportAnalytics({
      container: input.container,
      duration_bucket: bucketTimelineDuration(Math.max(0, input.endTime - input.startTime)),
      encoder: input.encoder,
      fps_bucket: bucketFps(input.fps),
      kind: input.kind,
      resolution_bucket: bucketResolution(input.width, input.height),
    });
    activeAnalyticsRunRef.current = run;
    return run;
  }, []);

  const clearAnalyticsRun = useCallback((run: AnalyticsExportRun) => {
    if (activeAnalyticsRunRef.current?.id === run.id) {
      activeAnalyticsRunRef.current = null;
    }
  }, []);

  const createStoryboardFrameDecorator = useCallback((renderWidth: number, renderHeight: number) => {
    if (storyboardExportMode !== 'animatic-export') return undefined;
    return createStoryboardAnimaticExportFrameDecorator({
      clips: storyboardClips,
      tracks: storyboardTracks,
      mediaFiles: storyboardMediaFiles,
      width: renderWidth,
      height: renderHeight,
      cameraMove: 'push-in',
      watermark: 'ANIMATIC',
    });
  }, [
    storyboardClips,
    storyboardExportMode,
    storyboardMediaFiles,
    storyboardTracks,
  ]);

  const ensureStoryboardVideoExportAllowed = useCallback((): boolean => {
    if (storyboardExportMode !== 'normal-export') return true;
    const range = getCurrentExportRange();
    const guard = resolveStoryboardExportGuard({
      mode: 'normal-export',
      clips: storyboardClips,
      tracks: storyboardTracks,
      startTime: range.startTime,
      endTime: range.endTime,
    });
    if (!guard.blocked) return true;
    setError(
      `Normal export blocked: ${guard.warnings.length} storyboard ` +
      `${guard.warnings.length === 1 ? 'scene has' : 'scenes have'} no accepted media. ` +
      'Choose Animatic export to render scene slates.',
    );
    return false;
  }, [
    getCurrentExportRange,
    setError,
    storyboardClips,
    storyboardExportMode,
    storyboardTracks,
  ]);

  const handleWebCodecsExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: containerFormat,
      encoder,
      endTime,
      fps: exportFps,
      height: actualHeight,
      kind: 'video',
      startTime,
      width: actualWidth,
    });
    startExport(startTime, endTime);

    try {
      const result = await runWebCodecsExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        videoCodec, containerFormat, bitrate, rateControl, stackedAlpha,
        includeAudio, audioSampleRate, audioBitrate, normalizeAudio,
        exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
        filename,
        onExporter: setExporter,
        onProgress: setProgress,
        onTimelineProgress: setExportProgress,
        frameDecorator: createStoryboardFrameDecorator(actualWidth, actualHeight),
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
        completeExportAnalytics(analyticsRun);
      } else {
        cancelExportAnalytics(analyticsRun);
      }
    } catch (e) {
      log.error('Export failed', e);
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
      setIsExporting(false);
      setExporter(null);
      endExport();
    }
  }, [audioBitrate, audioSampleRate, bitrate, clearAnalyticsRun, containerFormat, createStoryboardFrameDecorator, customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, height, includeAudio, isExporting, normalizeAudio, rateControl, setError, setExportProgress, setExporter, setIsExporting, setProgress, stackedAlpha, startAnalyticsRun, startExport, useCustomFps, useCustomResolution, videoCodec, width]);

  const handleCancel = useCallback(() => {
    if (activeAnalyticsRunRef.current) {
      cancelExportAnalytics(activeAnalyticsRunRef.current);
      activeAnalyticsRunRef.current = null;
    }
    if (!videoEnabled) {
      audioOnlyCancelledRef.current = true;
      ffmpegAudioPipelineRef.current?.cancel();
    } else if (visualMode === 'gif' || visualMode === 'image') {
      ffmpegFrameRendererRef.current?.cancel();
      getFFmpegBridge().cancel();
    } else if (encoder === 'webcodecs' || encoder === 'htmlvideo') {
      exporter?.cancel();
      setExporter(null);
    } else if (encoder === 'hap') {
      // Browser-native HAP export never touches the FFmpeg bridge.
      ffmpegFrameRendererRef.current?.cancel();
      ffmpegAudioPipelineRef.current?.cancel();
    } else {
      ffmpegFrameRendererRef.current?.cancel();
      ffmpegAudioPipelineRef.current?.cancel();
      getFFmpegBridge().cancel();
    }
    exportRenderSessionRef.current?.cancel('Export cancelled');
    // Runner finally blocks release the timeline lock after resource cleanup.
  }, [encoder, endExport, exporter, setExportPhase, setExporter, setIsExporting, videoEnabled, visualMode]);

  const handleBrowserGifExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: 'gif',
      encoder,
      endTime,
      fps: exportFps,
      height: actualHeight,
      kind: 'gif',
      startTime,
      width: actualWidth,
    });

    startExport(startTime, endTime);

    try {
      const result = await runBrowserGifExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
        filename, gifColors, gifDither, gifLoop, gifLoopCount, gifPaletteMode, gifOptimize,
        gifTransparency, gifAlphaThreshold, gifBayerScale,
        frameRendererRef: ffmpegFrameRendererRef, renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl({
          ...options,
          compositionId: activeCompositionId,
          frameDecorator: createStoryboardFrameDecorator(options.width, options.height),
        }),
        onProgress: setProgress, onTimelineProgress: setExportProgress,
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
        completeExportAnalytics(analyticsRun);
      } else {
        cancelExportAnalytics(analyticsRun);
      }
    } catch (e) {
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'GIF export failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
      setIsExporting(false);
      endExport();
    }
  }, [activeCompositionId, clearAnalyticsRun, createStoryboardFrameDecorator, customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, gifAlphaThreshold, gifBayerScale, gifColors, gifDither, gifLoop, gifLoopCount, gifOptimize, gifPaletteMode, gifTransparency, height, isExporting, setError, setExportProgress, setIsExporting, setProgress, startAnalyticsRun, startExport, useCustomFps, useCustomResolution, width]);

  const handleHapExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);
    setExportPhase('rendering');

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: 'mov',
      encoder: 'hap',
      endTime,
      fps: exportFps,
      height: actualHeight,
      kind: 'video',
      startTime,
      width: actualWidth,
    });

    startExport(startTime, endTime);

    try {
      const result = await runHapExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        exportMode: 'precise',
        filename, hapFormat, includeAlpha: preserveNativeAlpha,
        includeAudio, audioSampleRate, audioBitrate, normalizeAudio,
        frameRendererRef: ffmpegFrameRendererRef, audioPipelineRef: ffmpegAudioPipelineRef,
        renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl({
          ...options,
          compositionId: activeCompositionId,
          frameDecorator: createStoryboardFrameDecorator(options.width, options.height),
        }),
        onProgress: setProgress, onTimelineProgress: setExportProgress,
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
        completeExportAnalytics(analyticsRun);
      } else {
        cancelExportAnalytics(analyticsRun);
      }
    } catch (e) {
      log.error('HAP export failed', e);
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'HAP export failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
      setIsExporting(false);
      setExportPhase('idle');
      endExport();
    }
  }, [activeCompositionId, audioBitrate, audioSampleRate, clearAnalyticsRun, createStoryboardFrameDecorator, customFps, customHeight, customWidth, endExport, filename, fps, getCurrentExportRange, hapFormat, height, includeAudio, isExporting, normalizeAudio, preserveNativeAlpha, setError, setExportPhase, setExportProgress, setIsExporting, setProgress, startAnalyticsRun, startExport, useCustomFps, useCustomResolution, width]);

  const handleFFmpegExport = useCallback(async () => {
    if (isExporting) return;

    if (!isFFmpegReady) {
      await loadFFmpeg();
      if (!getFFmpegBridge().isLoaded()) {
        setError('FFmpeg not loaded');
        return;
      }
    }

    setIsExporting(true);
    setError(null);
    setFfmpegProgress(null);
    setExportPhase('rendering');

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: ffmpegContainer || visualMode,
      encoder: 'ffmpeg',
      endTime,
      fps: exportFps,
      height: actualHeight,
      kind: visualMode === 'gif' ? 'gif' : 'video',
      startTime,
      width: actualWidth,
    });

    startExport(startTime, endTime);

    try {
      const result = await runFfmpegDirectExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        filename, visualMode, includeAudio, audioSampleRate, audioBitrate, normalizeAudio,
        includeAlpha: preserveNativeAlpha,
        ffmpegCodec, ffmpegContainer, ffmpegQuality, proresProfile, dnxhrProfile,
        gifColors, gifDither, gifLoop, gifLoopCount, gifPaletteMode, gifOptimize,
        gifTransparency, gifAlphaThreshold, gifBayerScale,
        frameRendererRef: ffmpegFrameRendererRef, audioPipelineRef: ffmpegAudioPipelineRef,
        renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl({
          ...options,
          compositionId: activeCompositionId,
          frameDecorator: createStoryboardFrameDecorator(options.width, options.height),
        }),
        onFfmpegProgress: setFfmpegProgress, onTimelineProgress: setExportProgress, onPhase: setExportPhase,
      });

      if (result) {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        completeExportAnalytics(analyticsRun);
      } else {
        cancelExportAnalytics(analyticsRun);
      }
    } catch (e) {
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
      ffmpegAudioPipelineRef.current = null;
      setIsExporting(false);
      setExportPhase('idle');
      endExport();
    }
  }, [activeCompositionId, audioBitrate, audioSampleRate, clearAnalyticsRun, createStoryboardFrameDecorator, customFps, customHeight, customWidth, dnxhrProfile, endExport, ffmpegCodec, ffmpegContainer, ffmpegQuality, filename, fps, getCurrentExportRange, gifAlphaThreshold, gifBayerScale, gifColors, gifDither, gifLoop, gifLoopCount, gifOptimize, gifPaletteMode, gifTransparency, height, includeAudio, isExporting, isFFmpegReady, loadFFmpeg, normalizeAudio, preserveNativeAlpha, proresProfile, setError, setExportPhase, setExportProgress, setFfmpegProgress, setIsExporting, startAnalyticsRun, startExport, useCustomFps, useCustomResolution, visualMode, width]);

  const handleExportAudioOnly = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    audioOnlyCancelledRef.current = false;
    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const actualFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: audioOnlyFormat,
      encoder,
      endTime,
      fps: actualFps,
      height: actualHeight,
      kind: 'audio',
      startTime,
      width: actualWidth,
    });
    let timelineExportStarted = false;

    try {
      const result = await runAudioOnlyExport({
        width: actualWidth, height: actualHeight, fps: actualFps, startTime, endTime,
        filename, encoder, videoCodec, containerFormat, bitrate,
        audioOnlyFormat, audioSampleRate, audioBitrate, normalizeAudio,
        audioPipelineRef: ffmpegAudioPipelineRef,
        cancelledRef: audioOnlyCancelledRef,
        onProgress: setProgress,
        onTimelineProgress: setExportProgress,
        onTimelineStart: (rangeStart, rangeEnd) => {
          startExport(rangeStart, rangeEnd);
          timelineExportStarted = true;
        },
      });

      if (result.kind === 'download') {
        downloadBlob(result.blob, result.filename);
        completeExportAnalytics(analyticsRun);
      } else if (result.kind === 'cancelled') {
        log.info('Audio export cancelled');
        cancelExportAnalytics(analyticsRun);
      } else {
        failExportAnalytics(analyticsRun, result.message);
        setError(result.message);
      }
    } catch (e) {
      log.error('Audio export failed', e);
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'Audio export failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
      ffmpegAudioPipelineRef.current = null;
      setIsExporting(false);
      if (timelineExportStarted) {
        endExport();
      }
    }
  }, [audioBitrate, audioOnlyFormat, audioSampleRate, bitrate, clearAnalyticsRun, containerFormat, customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, height, isExporting, normalizeAudio, setError, setExportProgress, setIsExporting, setProgress, startAnalyticsRun, startExport, useCustomFps, useCustomResolution, videoCodec, width]);

  const handleExportFCPXML = useCallback(() => {
    const { startTime, endTime } = getCurrentExportRange();
    const analyticsRun = startAnalyticsRun({
      container: 'fcpxml', encoder: 'xml', endTime, fps, height,
      kind: 'fcpxml', startTime, width,
    });
    try {
      runFcpxmlExport({
        getActiveComposition,
        filename,
        fps,
        width,
        height,
        includeAudio,
      });
      completeExportAnalytics(analyticsRun);
    } catch (error) {
      failExportAnalytics(analyticsRun, error);
      throw error;
    } finally {
      clearAnalyticsRun(analyticsRun);
    }
  }, [clearAnalyticsRun, filename, fps, getActiveComposition, getCurrentExportRange, height, includeAudio, startAnalyticsRun, width]);

  const handleRenderFrame = useCallback(async () => {
    if (isExporting) return;

    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportTime = playheadPosition;
    const exportFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: imageFormat,
      encoder: 'image',
      endTime: exportTime,
      fps: exportFps,
      height: actualHeight,
      kind: 'still',
      startTime: exportTime,
      width: actualWidth,
    });

    try {
      const result = await runStillImageExport({
        width: actualWidth, height: actualHeight, fps: exportFps, exportTime,
        filename, imageFormat, imageQuality, selectedImageFormat,
        renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl({
          ...options,
          compositionId: activeCompositionId,
          frameDecorator: createStoryboardFrameDecorator(options.width, options.height),
        }),
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
        completeExportAnalytics(analyticsRun);
      } else {
        cancelExportAnalytics(analyticsRun);
      }
    } catch (e) {
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'Frame render failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
    }
  }, [activeCompositionId, clearAnalyticsRun, createStoryboardFrameDecorator, customFps, customHeight, customWidth, filename, fps, height, imageFormat, imageQuality, isExporting, playheadPosition, selectedImageFormat, setError, startAnalyticsRun, useCustomFps, useCustomResolution, width]);

  const handleRenderImageSequence = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);
    setExportPhase('rendering');

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const analyticsRun = startAnalyticsRun({
      container: imageFormat,
      encoder,
      endTime,
      fps: exportFps,
      height: actualHeight,
      kind: 'image_sequence',
      startTime,
      width: actualWidth,
    });
    let timelineExportStarted = false;

    try {
      const result = await runImageSequenceExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
        filename, imageFormat, imageQuality, selectedImageFormat,
        frameRendererRef: ffmpegFrameRendererRef, renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl({
          ...options,
          compositionId: activeCompositionId,
          frameDecorator: createStoryboardFrameDecorator(options.width, options.height),
        }),
        onTimelineStart: (rangeStart, rangeEnd) => {
          startExport(rangeStart, rangeEnd);
          timelineExportStarted = true;
        },
        onProgress: setProgress, onTimelineProgress: setExportProgress,
      });

      if (result?.kind === 'zip') {
        downloadBlob(result.blob, result.filename);
      }
      if (result) completeExportAnalytics(analyticsRun);
      else cancelExportAnalytics(analyticsRun);
    } catch (e) {
      failExportAnalytics(analyticsRun, e);
      setError(e instanceof Error ? e.message : 'Image sequence export failed');
    } finally {
      clearAnalyticsRun(analyticsRun);
      setExportPhase('idle');
      setIsExporting(false);
      if (timelineExportStarted) {
        endExport();
      }
    }
  }, [activeCompositionId, clearAnalyticsRun, createStoryboardFrameDecorator, customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, height, imageFormat, imageQuality, isExporting, selectedImageFormat, setError, setExportPhase, setExportProgress, setIsExporting, setProgress, startAnalyticsRun, startExport, useCustomFps, useCustomResolution, width]);

  const handlePrimaryExport = useCallback(async () => {
    if (isXmlMode) {
      handleExportFCPXML();
      return;
    }

    if (isImageMode) {
      if (isImageSequenceMode) {
        return handleRenderImageSequence();
      } else {
        return handleRenderFrame();
      }
    }

    if (isGifMode) {
      if (encoder === 'ffmpeg') {
        return handleFFmpegExport();
      } else {
        return handleBrowserGifExport();
      }
    }

    if (!videoEnabled) {
      if (includeAudio) {
        return handleExportAudioOnly();
      }
      return;
    }

    if (!ensureStoryboardVideoExportAllowed()) return;

    if (isWebCodecsEncoder) {
      return handleWebCodecsExport();
    }

    if (encoder === 'hap') {
      return handleHapExport();
    }

    return handleFFmpegExport();
  }, [encoder, ensureStoryboardVideoExportAllowed, handleBrowserGifExport, handleExportAudioOnly, handleExportFCPXML, handleFFmpegExport, handleHapExport, handleRenderFrame, handleRenderImageSequence, handleWebCodecsExport, includeAudio, isGifMode, isImageMode, isImageSequenceMode, isWebCodecsEncoder, isXmlMode, videoEnabled]);

  return {
    handleCancel,
    handlePrimaryExport: () => { void submissionGate.run(handlePrimaryExport).catch(error => {
      if (activeAnalyticsRunRef.current) {
        failExportAnalytics(activeAnalyticsRunRef.current, error); activeAnalyticsRunRef.current = null;
      }
      setError(error instanceof Error ? error.message : 'Export setup failed');
      setIsExporting(false); endExport();
    }); },
  };
}
