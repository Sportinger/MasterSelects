// Export Panel - embedded panel for frame-by-frame video export

import { useCallback, useRef, useState } from 'react';
import './ExportPanel.css';
import { Logger } from '../../services/logger';
import { downloadFCPXML } from '../../services/export/fcpxmlExport';
import { projectFileService } from '../../services/projectFileService';

const log = Logger.create('ExportPanel');
import { FrameExporter, downloadBlob } from '../../engine/export';
import type { VideoCodec, ContainerFormat } from '../../engine/export';
import { AudioExportPipeline } from '../../engine/audio';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { engine } from '../../engine/WebGPUEngine';
import { syncExportMaskTextures } from '../../engine/export/ExportMaskTextures';
import {
  blobToUint8Array,
  createImageSequenceZip,
  getImageSequenceFolderName,
  getImageSequenceFrameName,
  isImageSequenceFolderExportSupported,
  isImageSequenceFolderSelectionAbort,
  pickImageSequenceOutputDirectory,
  writeImageSequenceFrame,
} from '../../engine/export/ImageSequenceExporter';
import type { ImageSequenceDirectoryHandle, ImageSequenceEntry } from '../../engine/export/ImageSequenceExporter';
import {
  getFFmpegBridge,
  PRORES_PROFILES,
  DNXHR_PROFILES,
  CONTAINER_FORMATS,
  getCodecInfo,
  getCodecsForContainer,
} from '../../engine/ffmpeg';
import { CodecSelector } from './CodecSelector';
import { encodeBrowserGif } from '../../engine/export/BrowserGifExporter';
import {
  GIF_COLOR_PRESETS,
  GIF_DITHER_OPTIONS,
  GIF_PALETTE_MODES,
  estimateGifSize,
  formatByteSize,
  getGifDitherLabel,
  getGifPaletteModeLabel,
} from '../../engine/gif/gifOptions';
import type {
  FFmpegExportSettings,
  FFmpegProgress,
  FFmpegContainer,
  FFmpegVideoCodec,
  ProResProfile,
  DnxhrProfile,
} from '../../engine/ffmpeg';
import { FFmpegFrameRenderer } from './exportHelpers';
import { resolveExportRange } from './exportRange';
import { useExportState, type EncoderType } from './useExportState';
import {
  useExportStore,
  type ExportImageFormat as ImageFormat,
} from '../../stores/exportStore';

type ExportSummaryTarget =
  | 'command-bar'
  | 'basic-output'
  | 'basic-container'
  | 'basic-workflow'
  | 'video-section'
  | 'video-resolution'
  | 'video-fps'
  | 'video-rate'
  | 'video-codec'
  | 'video-alpha'
  | 'gif-palette'
  | 'image-section'
  | 'image-mode'
  | 'image-resolution'
  | 'image-fps'
  | 'image-quality'
  | 'image-range'
  | 'audio-section'
  | 'audio-format'
  | 'audio-quality'
  | 'audio-processing';

type ExportSummaryBadge = {
  label: string;
  target: ExportSummaryTarget;
  warning?: boolean;
};

const IMAGE_FORMATS: Array<{
  id: ImageFormat;
  label: string;
  mimeType: string;
  supportsAlpha: boolean;
  lossless: boolean;
}> = [
  { id: 'png', label: 'PNG', mimeType: 'image/png', supportsAlpha: true, lossless: true },
  { id: 'jpg', label: 'JPG', mimeType: 'image/jpeg', supportsAlpha: false, lossless: false },
  { id: 'webp', label: 'WebP', mimeType: 'image/webp', supportsAlpha: true, lossless: false },
  { id: 'bmp', label: 'BMP', mimeType: 'image/bmp', supportsAlpha: false, lossless: true },
];

const IMAGE_QUALITY_PRESETS = [
  { id: 'draft', label: 'Draft', value: 0.72 },
  { id: 'standard', label: 'Standard', value: 0.85 },
  { id: 'high', label: 'High', value: 0.92 },
  { id: 'max', label: 'Max', value: 1 },
] as const;

type ImageFormatOption = typeof IMAGE_FORMATS[number];

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error(`Failed to export ${type}`));
    }, type, quality);
  });
}

function encodeBmp(imageData: ImageData): Blob {
  const { width, height, data } = imageData;
  const rowStride = width * 3;
  const rowPadding = (4 - (rowStride % 4)) % 4;
  const paddedRowStride = rowStride + rowPadding;
  const pixelArraySize = paddedRowStride * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * 4;
      view.setUint8(offset++, data[pixelOffset + 2]);
      view.setUint8(offset++, data[pixelOffset + 1]);
      view.setUint8(offset++, data[pixelOffset]);
    }
    offset += rowPadding;
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

async function encodeImageDataToBlob(
  imageData: ImageData,
  format: ImageFormatOption,
  quality: number,
): Promise<Blob> {
  if (format.id === 'bmp') {
    return encodeBmp(imageData);
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(
    canvas,
    format.mimeType,
    format.lossless ? undefined : quality,
  );
}

export function ExportPanel() {
  const ffmpegFrameRendererRef = useRef<FFmpegFrameRenderer | null>(null);
  const ffmpegAudioPipelineRef = useRef<AudioExportPipeline | null>(null);
  const summaryHighlightTimeoutsRef = useRef<Map<HTMLElement, number>>(new Map());
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const { duration, inPoint, outPoint, playheadPosition, startExport, setExportProgress, endExport } = useTimelineStore(useShallow(s => ({
    duration: s.duration,
    inPoint: s.inPoint,
    outPoint: s.outPoint,
    playheadPosition: s.playheadPosition,
    startExport: s.startExport,
    setExportProgress: s.setExportProgress,
    endExport: s.endExport,
  })));
  const { getActiveComposition } = useMediaStore(useShallow(s => ({
    getActiveComposition: s.getActiveComposition,
  })));
  const composition = getActiveComposition();
  const {
    presets,
    selectedPresetId,
    setSelectedPresetId,
    savePreset,
    updatePreset,
    loadPreset,
  } = useExportStore(useShallow((state) => ({
    presets: state.presets,
    selectedPresetId: state.selectedPresetId,
    setSelectedPresetId: state.setSelectedPresetId,
    savePreset: state.savePreset,
    updatePreset: state.updatePreset,
    loadPreset: state.loadPreset,
  })));

  // All export state, effects, and simple handlers extracted to hook
  const {
    encoder, setEncoder,
    width, height,
    customWidth, setCustomWidth, customHeight, setCustomHeight,
    useCustomResolution, setUseCustomResolution,
    fps, setFps, customFps, setCustomFps, useCustomFps, setUseCustomFps,
    useInOut, setUseInOut, filename, setFilename,
    bitrate, setBitrate, containerFormat, setContainerFormat,
    videoCodec, setVideoCodec, codecSupport, rateControl, setRateControl,
    ffmpegCodec, ffmpegContainer,
    proresProfile, setProresProfile, dnxhrProfile, setDnxhrProfile,
    ffmpegQuality, setFfmpegQuality, ffmpegBitrate, ffmpegRateControl,
    gifColors, setGifColors,
    gifDither, setGifDither,
    gifLoop, setGifLoop,
    gifPaletteMode, setGifPaletteMode,
    gifOptimize, setGifOptimize,
    gifAlphaThreshold, setGifAlphaThreshold,
    isFFmpegLoading, isFFmpegReady, ffmpegLoadError,
    stackedAlpha, setStackedAlpha,
    includeAudio, setIncludeAudio, audioSampleRate, setAudioSampleRate,
    audioBitrate, setAudioBitrate, normalizeAudio, setNormalizeAudio,
    videoEnabled, setVideoEnabled,
    visualMode, setVisualMode,
    imageFormat, setImageFormat,
    imageExportMode, setImageExportMode,
    imageQuality, setImageQuality,
    specialContainer, setSpecialContainer,
    isExporting, setIsExporting, progress, setProgress,
    ffmpegProgress, setFfmpegProgress, exportPhase, setExportPhase,
    error, setError, exporter, setExporter,
    isSupported, isAudioSupported, audioCodec,
    isFFmpegSupported, isFFmpegMultiThreaded,
    handleResolutionChange, loadFFmpeg,
    handleFFmpegContainerChange, handleFFmpegCodecChange,
  } = useExportState(composition);

  // Compute actual start/end based on In/Out markers for display.
  const { startTime, endTime } = resolveExportRange({ duration, inPoint, outPoint }, useInOut);

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

  // Handle export (WebCodecs)
  const handleExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;

    // Get file extension from container format
    const fileExtension = containerFormat === 'webm' ? 'webm' : 'mp4';

    const exportFps = useCustomFps ? customFps : fps;

    const exp = new FrameExporter({
      width: actualWidth,
      height: actualHeight,
      fps: exportFps,
      codec: videoCodec,
      container: containerFormat,
      bitrate,
      rateControl,
      startTime,
      endTime,
      // Alpha
      stackedAlpha,
      // Audio settings
      includeAudio,
      audioSampleRate,
      audioBitrate,
      normalizeAudio,
      // Export mode: webcodecs = fast, htmlvideo = precise
      exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
    });
    setExporter(exp);

    // Start export progress in timeline
    startExport(startTime, endTime);

    try {
      const blob = await exp.export((p) => {
        setProgress(p);
        // Update timeline export progress
        setExportProgress(p.percent, p.currentTime);
      });

      if (blob) {
        downloadBlob(blob, `${filename}.${fileExtension}`);
      }
    } catch (e) {
      log.error('Export failed', e);
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setExporter(null);
      // End export progress in timeline
      endExport();
    }
  }, [
    audioBitrate,
    audioSampleRate,
    bitrate,
    containerFormat,
    customFps,
    customHeight,
    customWidth,
    encoder,
    endExport,
    filename,
    fps,
    includeAudio,
    isExporting,
    normalizeAudio,
    rateControl,
    setError,
    setExportProgress,
    setExporter,
    setIsExporting,
    setProgress,
    getCurrentExportRange,
    stackedAlpha,
    startExport,
    useCustomFps,
    useCustomResolution,
    videoCodec,
    width,
    height,
  ]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (visualMode === 'gif' || visualMode === 'image') {
      ffmpegFrameRendererRef.current?.cancel();
      const ffmpeg = getFFmpegBridge();
      ffmpeg.cancel();
    } else if (encoder === 'webcodecs' || encoder === 'htmlvideo') {
      if (exporter) {
        exporter.cancel();
      }
      setExporter(null);
    } else {
      ffmpegFrameRendererRef.current?.cancel();
      ffmpegAudioPipelineRef.current?.cancel();
      const ffmpeg = getFFmpegBridge();
      ffmpeg.cancel();
    }
    setIsExporting(false);
    setExportPhase('idle');
    // End export progress in timeline
    endExport();
  }, [exporter, encoder, endExport, setExporter, setExportPhase, setIsExporting, visualMode]);

  // Handle browser-side GIF export. This is not a WebCodecs codec, but it shares
  // the browser render path so GIF is available without loading FFmpeg.
  const handleBrowserGifExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const originalDimensions = engine.getOutputDimensions();
    const frameRenderer = new FFmpegFrameRenderer({
      width: actualWidth,
      height: actualHeight,
      fps: exportFps,
      startTime,
      endTime,
      exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
    });
    ffmpegFrameRendererRef.current = frameRenderer;

    startExport(startTime, endTime);

    try {
      await frameRenderer.initialize();

      const frames: Uint8Array[] = [];
      const totalFrames = Math.ceil((endTime - startTime) * exportFps);
      const frameDuration = 1 / exportFps;

      engine.setExporting(true);
      engine.setResolution(actualWidth, actualHeight);

      for (let i = 0; i < totalFrames; i++) {
        if (frameRenderer.isCancelled()) {
          return;
        }

        const time = startTime + i * frameDuration;
        const layers = await frameRenderer.buildLayersAtTime(time);

        engine.setRenderTimeOverride(time);
        syncExportMaskTextures(layers, actualWidth, actualHeight);
        await engine.ensureExportLayersReady(layers);
        engine.render(layers);

        const pixels = await engine.readPixels();
        if (!pixels) {
          throw new Error('Failed to read frame from GPU');
        }

        const frameCopy = new Uint8Array(pixels.length);
        frameCopy.set(pixels);
        frames.push(frameCopy);

        const percent = ((i + 1) / totalFrames) * 60;
        setProgress({
          phase: 'video',
          currentFrame: i + 1,
          totalFrames,
          percent,
          estimatedTimeRemaining: 0,
          currentTime: time,
        });
        setExportProgress(percent, time);
      }

      engine.setExporting(false);
      engine.setResolution(originalDimensions.width, originalDimensions.height);

      if (frames.length === 0) {
        throw new Error('No frames rendered');
      }

      const blob = encodeBrowserGif(frames, {
        width: actualWidth,
        height: actualHeight,
        fps: exportFps,
        gifColors,
        gifDither,
        gifLoop,
        gifPaletteMode,
        gifOptimize,
        gifAlphaThreshold,
      }, (gifProgress) => {
        const percent = 60 + (gifProgress.percent / 100) * 40;
        setProgress({
          phase: 'video',
          currentFrame: gifProgress.frame,
          totalFrames,
          percent,
          estimatedTimeRemaining: 0,
          currentTime: endTime,
        });
        setExportProgress(percent, endTime);
      });

      downloadBlob(blob, `${filename}.gif`);
    } catch (e) {
      if (frameRenderer.isCancelled()) {
        log.info('Browser GIF export cancelled');
        return;
      }
      log.error('Browser GIF export failed', e);
      setError(e instanceof Error ? e.message : 'GIF export failed');
    } finally {
      frameRenderer.cleanup();
      ffmpegFrameRendererRef.current = null;
      engine.setRenderTimeOverride(null);
      engine.setExporting(false);
      engine.setResolution(originalDimensions.width, originalDimensions.height);
      setIsExporting(false);
      endExport();
    }
  }, [
    customFps,
    customHeight,
    customWidth,
    encoder,
    endExport,
    filename,
    fps,
    getCurrentExportRange,
    gifAlphaThreshold,
    gifColors,
    gifDither,
    gifLoop,
    gifOptimize,
    gifPaletteMode,
    height,
    isExporting,
    setError,
    setExportProgress,
    setIsExporting,
    setProgress,
    startExport,
    useCustomFps,
    useCustomResolution,
    width,
  ]);

  // Handle FFmpeg export
  const handleFFmpegExport = useCallback(async () => {
    if (isExporting) return;

    // Ensure FFmpeg is loaded
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
    const exportAsGif = visualMode === 'gif';
    const timelineState = useTimelineStore.getState();
    const shouldIncludeAudio = includeAudio && !exportAsGif && AudioExportPipeline.hasAudioInRange(
      Array.isArray(timelineState.clips) ? timelineState.clips : [],
      Array.isArray(timelineState.tracks) ? timelineState.tracks : [],
      startTime,
      endTime,
    );
    const originalDimensions = engine.getOutputDimensions();
    const ffmpegFrameRenderer = new FFmpegFrameRenderer({
      width: actualWidth,
      height: actualHeight,
      fps: exportFps,
      startTime,
      endTime,
    });
    ffmpegFrameRendererRef.current = ffmpegFrameRenderer;

    // Start export progress in timeline
    startExport(startTime, endTime);

    try {
      await ffmpegFrameRenderer.initialize();

      const settings: FFmpegExportSettings = {
        codec: exportAsGif ? 'gif' : ffmpegCodec,
        container: exportAsGif ? 'gif' : ffmpegContainer,
        width: actualWidth,
        height: actualHeight,
        fps: exportFps,
        startTime,
        endTime,
        quality: !exportAsGif && ffmpegCodec === 'mjpeg' ? ffmpegQuality : undefined,
        bitrate: undefined, // Bitrate not used for available codecs
        proresProfile: !exportAsGif && ffmpegCodec === 'prores' ? proresProfile : undefined,
        dnxhrProfile: !exportAsGif && ffmpegCodec === 'dnxhd' ? dnxhrProfile : undefined,
        gifColors,
        gifDither,
        gifLoop,
        gifPaletteMode,
        gifOptimize,
        gifAlphaThreshold,
        // HAP not available in ASYNCIFY build
      };

      // Render frames
      log.info('Rendering frames for FFmpeg...');
      const frames: Uint8Array[] = [];
      const totalFrames = Math.ceil((endTime - startTime) * exportFps);
      const frameDuration = 1 / exportFps;

      log.info(`Total frames: ${totalFrames}, duration: ${frameDuration.toFixed(4)}s per frame`);

      // Set engine to export mode and correct resolution
      engine.setExporting(true);
      engine.setResolution(actualWidth, actualHeight);

      const frameStartTime = performance.now();

      for (let i = 0; i < totalFrames; i++) {
        if (ffmpegFrameRenderer.isCancelled()) {
          log.info('FFmpeg export cancelled during frame rendering');
          return;
        }

        const time = startTime + i * frameDuration;

        if (i === 0) log.debug('Frame 0: Building layers...');

        // Build layers at this time and render
        const layers = await ffmpegFrameRenderer.buildLayersAtTime(time);

        if (i === 0) log.debug(`Frame 0: Got ${layers.length} layers`);

        if (layers.length === 0) {
          log.warn(`No layers at time ${time.toFixed(3)}`);
        }

        engine.setRenderTimeOverride(time);
        syncExportMaskTextures(layers, actualWidth, actualHeight);
        await engine.ensureExportLayersReady(layers);
        engine.render(layers);

        if (i === 0) log.debug('Frame 0: Render complete, reading pixels...');

        // Read pixels
        const pixels = await engine.readPixels();

        if (ffmpegFrameRenderer.isCancelled()) {
          log.info('FFmpeg export cancelled after frame render');
          return;
        }

        if (i === 0) log.debug(`Frame 0: Got pixels: ${pixels ? pixels.length : 'null'}`);
        if (pixels) {
          // Make a COPY of pixels (not a view) to ensure each frame is unique
          const frameCopy = new Uint8Array(pixels.length);
          frameCopy.set(pixels);
          frames.push(frameCopy);

          // Debug: check first few pixels to see if content changes
          if (i < 3 || i % 30 === 0) {
            const sample = [pixels[0], pixels[1], pixels[2], pixels[3], pixels[1000], pixels[2000]];
            log.debug(`Frame ${i} sample pixels: [${sample.join(', ')}]`);
          }
        }

        // Log progress every 30 frames or on first frame
        if (i === 0 || i % 30 === 0) {
          const elapsed = (performance.now() - frameStartTime) / 1000;
          const renderFps = (i + 1) / elapsed;
          log.debug(`Frame ${i + 1}/${totalFrames} at ${time.toFixed(3)}s, ${renderFps.toFixed(1)} fps, ${layers.length} layers`);
        }

        // Update progress during rendering (0-30% - frame capture is fast, encoding is slow)
        const percent = ((i + 1) / totalFrames) * 30;
        setFfmpegProgress({
          percent,
          frame: i + 1,
          fps: 0,
          time: time,
          speed: 0,
          bitrate: 0,
          size: 0,
          eta: 0,
        });
        // Update timeline export progress
        setExportProgress(percent, time);
      }

      // Reset export mode
      engine.setExporting(false);
      engine.setResolution(originalDimensions.width, originalDimensions.height);

      if (frames.length === 0) {
        throw new Error('No frames rendered');
      }

      // Extract audio from timeline (if enabled)
      let audioBuffer: AudioBuffer | null = null;

      if (includeAudio && !exportAsGif && !shouldIncludeAudio) {
        log.info('FFmpeg audio export skipped: no unmuted audio clips or mixdowns in export range');
      }

      if (shouldIncludeAudio) {
        setExportPhase('audio');
        log.info('Extracting audio for FFmpeg...');

        try {
          const audioPipeline = new AudioExportPipeline({
            sampleRate: audioSampleRate,
            bitrate: audioBitrate,
            normalize: normalizeAudio,
          });
          ffmpegAudioPipelineRef.current = audioPipeline;

          audioBuffer = await audioPipeline.exportRawAudio(
            startTime,
            endTime,
            (audioProgress) => {
              // Audio extraction: 30-40%
              const percent = 30 + (audioProgress.percent * 0.1);
              setFfmpegProgress({
                percent,
                frame: frames.length,
                fps: 0,
                time: endTime,
                speed: 0,
                bitrate: 0,
                size: 0,
                eta: 0,
              });
              setExportProgress(percent, endTime);
            }
          );
          ffmpegAudioPipelineRef.current = null;

          if (audioBuffer && audioBuffer.length > 0) {
            log.info(`Audio extracted: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.length} samples`);
          } else {
            log.warn('Audio extraction returned empty or null buffer');
          }
        } catch (audioError) {
          log.warn('Audio extraction failed, continuing without audio', audioError);
        }
      }

      // Encode with FFmpeg - this is the slow part (40-100%)
      setExportPhase('encoding');
      log.info(`Encoding ${frames.length} frames with FFmpeg...`);

      // Show 40% while encoding starts
      setFfmpegProgress({
        percent: 40,
        frame: frames.length,
        fps: 0,
        time: endTime,
        speed: 0,
        bitrate: 0,
        size: 0,
        eta: 0,
      });
      setExportProgress(40, endTime);

      // Allow React to render "Encoding..." before FFmpeg blocks the main thread
      await new Promise(resolve => setTimeout(resolve, 50));

      if (ffmpegFrameRenderer.isCancelled()) {
        log.info('FFmpeg export cancelled before encoding');
        return;
      }

      const ffmpeg = getFFmpegBridge();

      const blob = await ffmpeg.encode(frames, settings, (p: FFmpegProgress) => {
        // Encoding is 40-100% (60% of the progress bar - this is the slow part)
        const totalPercent = 40 + (p.percent / 100) * 60;
        setFfmpegProgress({
          ...p,
          percent: totalPercent,
        });
        setExportProgress(totalPercent, endTime);

        // Force UI update during encoding (callMain blocks main thread)
        // Note: This may not work due to WASM blocking, but worth trying
      }, audioBuffer);

      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.${exportAsGif ? 'gif' : ffmpegContainer}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      log.info('FFmpeg export complete');
    } catch (e) {
      if (ffmpegFrameRenderer.isCancelled()) {
        log.info('FFmpeg export cancelled');
        return;
      }
      const msg = e instanceof Error ? e.message : 'Export failed';
      setError(msg);
      log.error('FFmpeg export error', e);
    } finally {
      ffmpegAudioPipelineRef.current = null;
      ffmpegFrameRenderer.cleanup();
      ffmpegFrameRendererRef.current = null;
      engine.setRenderTimeOverride(null);
      // Always reset export mode
      engine.setExporting(false);
      engine.setResolution(originalDimensions.width, originalDimensions.height);
      setIsExporting(false);
      setExportPhase('idle');
      // End export progress in timeline
      endExport();
    }
  }, [
    isExporting, isFFmpegReady, loadFFmpeg, useCustomResolution, customWidth, customHeight,
    width, height, fps, customFps, useCustomFps, getCurrentExportRange, ffmpegCodec, ffmpegContainer,
    ffmpegQuality, proresProfile, dnxhrProfile, filename,
    gifAlphaThreshold, gifColors, gifDither, gifLoop, gifOptimize, gifPaletteMode, visualMode,
    includeAudio, audioSampleRate, audioBitrate, normalizeAudio,
    startExport, setExportProgress, endExport,
    setError, setExportPhase, setFfmpegProgress, setIsExporting,
  ]);

  // Handle audio-only export
  const handleExportAudioOnly = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    const { startTime, endTime } = getCurrentExportRange();
    setProgress({
      phase: 'audio',
      currentFrame: 0,
      totalFrames: 0,
      percent: 0,
      estimatedTimeRemaining: 0,
      currentTime: startTime,
      audioPhase: 'extracting',
      audioPercent: 0,
    });

    const audioPipeline = new AudioExportPipeline({
      sampleRate: audioSampleRate,
      bitrate: audioBitrate,
      normalize: normalizeAudio,
    });

    try {
      const audioResult = await audioPipeline.exportAudio(
        startTime,
        endTime,
        (audioProgress) => {
          setProgress({
            phase: 'audio',
            currentFrame: 0,
            totalFrames: 0,
            percent: audioProgress.percent,
            estimatedTimeRemaining: 0,
            currentTime: endTime,
            audioPhase: audioProgress.phase,
            audioPercent: audioProgress.percent,
          });
        }
      );

      if (audioResult && audioResult.chunks.length > 0) {
        // Convert audio chunks to a downloadable file
        // Use the codec from the result to determine mime type and extension
        const audioBlobs: Blob[] = [];
        for (const chunk of audioResult.chunks) {
          const buffer = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(buffer);
          audioBlobs.push(new Blob([buffer]));
        }
        const mimeType = audioResult.codec === 'opus' ? 'audio/ogg' : 'audio/aac';
        const extension = audioResult.codec === 'opus' ? 'ogg' : 'aac';
        const audioBlob = new Blob(audioBlobs, { type: mimeType });
        downloadBlob(audioBlob, `${filename}.${extension}`);
      } else {
        setError('No audio clips found in the selected range');
      }
    } catch (e) {
      log.error('Audio export failed', e);
      setError(e instanceof Error ? e.message : 'Audio export failed');
    } finally {
      setIsExporting(false);
    }
  }, [getCurrentExportRange, filename, isExporting, audioSampleRate, audioBitrate, normalizeAudio, setError, setIsExporting, setProgress]);

  // Handle FCPXML export
  const handleExportFCPXML = useCallback(() => {
    const { clips, tracks, duration: timelineDuration } = useTimelineStore.getState();
    const activeComp = getActiveComposition();

    downloadFCPXML(clips, tracks, timelineDuration, {
      projectName: activeComp?.name || filename || 'MasterSelects Export',
      frameRate: activeComp?.frameRate || fps,
      width: activeComp?.width || width,
      height: activeComp?.height || height,
      includeAudio,
    });
  }, [filename, fps, width, height, includeAudio, getActiveComposition]);

  // Handle render current frame
  const handleRenderFrame = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportTime = playheadPosition;
    const exportFps = useCustomFps ? customFps : fps;
    const selectedImageFormat = IMAGE_FORMATS.find(({ id }) => id === imageFormat) ?? IMAGE_FORMATS[0];
    const originalDimensions = engine.getOutputDimensions();
    const frameRenderer = new FFmpegFrameRenderer({
      width: actualWidth,
      height: actualHeight,
      fps: exportFps,
      startTime: exportTime,
      endTime: exportTime + (1 / Math.max(exportFps, 1)),
    });

    try {
      await frameRenderer.initialize();
      engine.setExporting(true);
      engine.setResolution(actualWidth, actualHeight);
      engine.setRenderTimeOverride(exportTime);

      const layers = await frameRenderer.buildLayersAtTime(exportTime);
      syncExportMaskTextures(layers, actualWidth, actualHeight);
      await engine.ensureExportLayersReady(layers);
      engine.render(layers);

      const pixels = await engine.readPixels();
      if (!pixels) {
        setError('Failed to read frame from GPU');
        return;
      }

      const imageData = new ImageData(new Uint8ClampedArray(pixels), actualWidth, actualHeight);
      const blob = await encodeImageDataToBlob(imageData, selectedImageFormat, imageQuality);
      const frameName = `${filename}_frame_${Math.floor(playheadPosition * 1000)}.${imageFormat}`;
      downloadBlob(blob, frameName);
    } catch (e) {
      log.error('Frame render failed', e);
      setError(e instanceof Error ? e.message : 'Frame render failed');
    } finally {
      frameRenderer.cleanup();
      engine.setRenderTimeOverride(null);
      engine.setExporting(false);
      engine.setResolution(originalDimensions.width, originalDimensions.height);
    }
  }, [
    width, height, customWidth, customHeight, useCustomResolution,
    fps, customFps, useCustomFps,
    filename, playheadPosition, imageFormat, imageQuality, isExporting,
    setError,
  ]);

  const handleRenderImageSequence = useCallback(async () => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setError(null);
    setProgress(null);
    setExportPhase('rendering');

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    const frameDuration = 1 / Math.max(exportFps, 1);
    const totalFrames = Math.max(1, Math.ceil(Math.max(0, endTime - startTime) * exportFps));
    const selectedImageFormat = IMAGE_FORMATS.find(({ id }) => id === imageFormat) ?? IMAGE_FORMATS[0];
    const originalDimensions = engine.getOutputDimensions();
    const folderExportSupported = isImageSequenceFolderExportSupported();
    const sequenceFolderName = getImageSequenceFolderName(filename, imageFormat);
    const frameRenderer = new FFmpegFrameRenderer({
      width: actualWidth,
      height: actualHeight,
      fps: exportFps,
      startTime,
      endTime: Math.max(endTime, startTime + frameDuration),
      exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
    });
    ffmpegFrameRendererRef.current = frameRenderer;
    let timelineExportStarted = false;

    try {
      const outputDirectory: ImageSequenceDirectoryHandle | null = folderExportSupported
        ? await pickImageSequenceOutputDirectory(sequenceFolderName)
        : null;

      startExport(startTime, endTime);
      timelineExportStarted = true;
      await frameRenderer.initialize();

      const sequenceEntries: ImageSequenceEntry[] = [];
      const startedAt = performance.now();
      engine.setExporting(true);
      engine.setResolution(actualWidth, actualHeight);

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (frameRenderer.isCancelled()) {
          return;
        }

        const frameTime = startTime + frameIndex * frameDuration;
        const layers = await frameRenderer.buildLayersAtTime(frameTime);

        engine.setRenderTimeOverride(frameTime);
        syncExportMaskTextures(layers, actualWidth, actualHeight);
        await engine.ensureExportLayersReady(layers);
        engine.render(layers);

        const pixels = await engine.readPixels();
        if (!pixels) {
          throw new Error('Failed to read frame from GPU');
        }

        const imageData = new ImageData(new Uint8ClampedArray(pixels), actualWidth, actualHeight);
        const blob = await encodeImageDataToBlob(imageData, selectedImageFormat, imageQuality);
        const filenameForFrame = getImageSequenceFrameName(filename, frameIndex, totalFrames, imageFormat);
        if (outputDirectory) {
          await writeImageSequenceFrame(outputDirectory, filenameForFrame, blob);
        } else {
          sequenceEntries.push({
            filename: filenameForFrame,
            data: await blobToUint8Array(blob),
          });
        }

        const completedFrames = frameIndex + 1;
        const renderPercent = (completedFrames / totalFrames) * 92;
        const elapsedMs = performance.now() - startedAt;
        const avgFrameMs = elapsedMs / completedFrames;
        const remainingFrames = totalFrames - completedFrames;
        setProgress({
          phase: 'video',
          currentFrame: completedFrames,
          totalFrames,
          percent: renderPercent,
          estimatedTimeRemaining: (remainingFrames * avgFrameMs) / 1000,
          currentTime: frameTime,
        });
        setExportProgress(renderPercent, frameTime);
      }

      if (frameRenderer.isCancelled()) {
        return;
      }

      if (!outputDirectory) {
        setProgress({
          phase: 'muxing',
          currentFrame: totalFrames,
          totalFrames,
          percent: 96,
          estimatedTimeRemaining: 0,
          currentTime: endTime,
        });
        setExportProgress(96, endTime);

        const zipBlob = createImageSequenceZip(sequenceEntries);
        downloadBlob(zipBlob, `${sequenceFolderName}.zip`);
      }

      setProgress({
        phase: 'muxing',
        currentFrame: totalFrames,
        totalFrames,
        percent: 100,
        estimatedTimeRemaining: 0,
        currentTime: endTime,
      });
      setExportProgress(100, endTime);
    } catch (e) {
      if (isImageSequenceFolderSelectionAbort(e)) {
        log.info('Image sequence folder export cancelled');
        return;
      }
      if (frameRenderer.isCancelled()) {
        log.info('Image sequence export cancelled');
        return;
      }
      log.error('Image sequence export failed', e);
      setError(e instanceof Error ? e.message : 'Image sequence export failed');
    } finally {
      frameRenderer.cleanup();
      ffmpegFrameRendererRef.current = null;
      engine.setRenderTimeOverride(null);
      engine.setExporting(false);
      engine.setResolution(originalDimensions.width, originalDimensions.height);
      setExportPhase('idle');
      setIsExporting(false);
      if (timelineExportStarted) {
        endExport();
      }
    }
  }, [
    customFps,
    customHeight,
    customWidth,
    encoder,
    endExport,
    filename,
    fps,
    getCurrentExportRange,
    height,
    imageFormat,
    imageQuality,
    isExporting,
    setError,
    setExportPhase,
    setExportProgress,
    setIsExporting,
    setProgress,
    startExport,
    useCustomFps,
    useCustomResolution,
    width,
  ]);

  // Format time as MM:SS.ff
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(2);
    return `${m}:${s.padStart(5, '0')}`;
  };

  // Get actual dimensions and FPS
  const actualWidth = useCustomResolution ? customWidth : width;
  const actualHeight = useCustomResolution ? customHeight : height;
  const actualFps = useCustomFps ? customFps : fps;
  const imageSequenceFrameCount = Math.max(1, Math.ceil(Math.max(0, endTime - startTime) * actualFps));
  const gifSizeEstimate = estimateGifSize({
    width: actualWidth,
    height: actualHeight,
    fps: actualFps,
    durationSeconds: endTime - startTime,
    gifColors,
    gifDither,
    gifLoop,
    gifPaletteMode,
    gifOptimize,
    gifAlphaThreshold,
  });
  const gifSizeRangeLabel = `${formatByteSize(gifSizeEstimate.minBytes)}-${formatByteSize(gifSizeEstimate.maxBytes)}`;

  // Format file size estimate - works for both encoders
  const estimatedSize = () => {
    const durationSec = endTime - startTime;
    if (durationSec <= 0) {
      return '-';
    }
    if (visualMode === 'gif') {
      return `~${formatByteSize(gifSizeEstimate.bytes)}`;
    }
    if (durationSec <= 0) return '—';

    let estimatedBitrate: number;

    if (!videoEnabled) {
      estimatedBitrate = audioBitrate;
    } else if (encoder === 'webcodecs' || encoder === 'htmlvideo') {
      estimatedBitrate = bitrate;
    } else if (ffmpegRateControl === 'crf') {
      const pixels = (useCustomResolution ? customWidth * customHeight : width * height);
      const qualityFactor = Math.pow(2, (51 - ffmpegQuality) / 6);
      estimatedBitrate = (pixels * actualFps * qualityFactor) / 10000;
      estimatedBitrate = Math.min(estimatedBitrate, 100_000_000);
    } else {
      estimatedBitrate = ffmpegBitrate;
    }

    if (videoEnabled && includeAudio && (encoder === 'webcodecs' || encoder === 'htmlvideo')) {
      estimatedBitrate += audioBitrate;
    }

    const bytes = (estimatedBitrate / 8) * durationSec;
    if (bytes > 1024 * 1024 * 1024) {
      return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  // Check if current encoder is available
  const webCodecsAvailable = isSupported;
  const ffmpegAvailable = isFFmpegSupported;

  // Get codec info for FFmpeg display
  const ffmpegCodecInfo = getCodecInfo(visualMode === 'gif' ? 'gif' : ffmpegCodec);
  // Only MJPEG has quality slider (q:v), professional codecs use profiles
  const showFFmpegQualityControl = visualMode !== 'gif' && ffmpegCodec === 'mjpeg';
  const isWebCodecsEncoder = encoder === 'webcodecs' || encoder === 'htmlvideo';
  const isXmlMode = specialContainer === 'xml';
  const isImageMode = !isXmlMode && videoEnabled && visualMode === 'image';
  const isImageSequenceMode = isImageMode && imageExportMode === 'sequence';
  const imageSequenceFolderSupported = isImageSequenceMode && isImageSequenceFolderExportSupported();
  const imageSequenceOutputLabel = imageSequenceFolderSupported ? 'Folder' : 'ZIP';
  const imageSequenceOutputName = imageSequenceFolderSupported
    ? `${getImageSequenceFolderName(filename || 'export', imageFormat)}/`
    : `${getImageSequenceFolderName(filename || 'export', imageFormat)}.zip`;
  const isGifMode = !isXmlMode && videoEnabled && visualMode === 'gif';
  const isVideoMode = !isXmlMode && videoEnabled && (visualMode === 'video' || isGifMode);
  const isAudioOnlyMode = !isXmlMode && !videoEnabled;
  const currentContainerId = isXmlMode ? 'fcpxml' : isGifMode ? 'gif' : (isWebCodecsEncoder ? containerFormat : ffmpegContainer);
  const currentContainerLabel = isXmlMode
    ? 'FCPXML'
    : isGifMode
      ? 'Animated GIF'
    : isWebCodecsEncoder
      ? FrameExporter.getContainerFormats().find(({ id }) => id === containerFormat)?.label ?? containerFormat.toUpperCase()
      : CONTAINER_FORMATS.find(({ id }) => id === ffmpegContainer)?.name ?? ffmpegContainer.toUpperCase();
  const currentCodecLabel = isGifMode
    ? (encoder === 'ffmpeg' ? 'FFmpeg GIF' : 'Browser GIF')
    : isWebCodecsEncoder
    ? FrameExporter.getVideoCodecs(containerFormat).find(({ id }) => id === videoCodec)?.label ?? videoCodec.toUpperCase()
    : ffmpegCodecInfo?.name ?? ffmpegCodec.toUpperCase();
  const methodMeta = isGifMode
    ? {
        title: encoder === 'ffmpeg' ? 'FFmpeg GIF' : 'Browser GIF',
        badge: encoder === 'ffmpeg' ? 'Palette' : 'Browser',
        description: encoder === 'ffmpeg'
          ? 'Palette and dither controlled animated GIF output.'
          : 'Browser-side animated GIF output without loading FFmpeg.',
      }
    : encoder === 'webcodecs'
    ? {
        title: 'WebCodecs Fast',
        badge: 'Fast',
        description: 'Best for quick delivery renders directly in the browser.',
      }
    : encoder === 'htmlvideo'
      ? {
          title: 'HTMLVideo Precise',
          badge: 'Precise',
          description: 'Safer for difficult seeking cases and frame-accurate timing.',
        }
      : {
          title: 'FFmpeg CPU',
          badge: isFFmpegMultiThreaded ? 'Intermediate' : 'CPU',
          description: 'Professional intermediates and edit-friendly interchange formats.',
        };
  const ffmpegAudioCodecLabel = isGifMode
    ? 'None'
    : ffmpegContainer === 'mov'
    ? 'AAC'
    : ffmpegContainer === 'mkv'
      ? 'FLAC'
      : ffmpegContainer === 'avi'
        ? 'PCM'
        : ffmpegContainer === 'mxf'
          ? 'PCM'
          : 'AAC';
  const effectiveIncludeAudio = (isVideoMode || isXmlMode) && includeAudio && !isGifMode;
  const selectedImageFormat = IMAGE_FORMATS.find(({ id }) => id === imageFormat) ?? IMAGE_FORMATS[0];
  const audioExtension = audioCodec === 'opus' ? 'ogg' : 'aac';
  const audioCodecLabel = audioCodec?.toUpperCase() ?? 'AAC';
  const currentAudioCodecLabel = isVideoMode && encoder === 'ffmpeg'
    ? ffmpegAudioCodecLabel
    : audioCodecLabel;
  const outputHeight = stackedAlpha && isVideoMode && !isGifMode ? actualHeight * 2 : actualHeight;
  const frameCount = isImageSequenceMode ? imageSequenceFrameCount : isVideoMode ? Math.ceil((endTime - startTime) * actualFps) : 1;
  const displayExtension = isXmlMode ? 'fcpxml' : isAudioOnlyMode ? audioExtension : isImageMode ? (isImageSequenceMode ? imageSequenceOutputLabel.toLowerCase() : imageFormat) : isGifMode ? 'gif' : currentContainerId;
  const displayOutputName = isImageSequenceMode ? imageSequenceOutputName : `${filename || 'export'}.${displayExtension}`;
  const displayContainerLabel = isImageSequenceMode ? imageSequenceOutputLabel : `.${displayExtension}`;
  const estimatedSizeLabel = isXmlMode ? 'Metadata only' : isImageMode ? (isImageSequenceMode ? `${imageSequenceFrameCount} frames ${imageSequenceOutputLabel}` : 'Current frame') : (!videoEnabled && !includeAudio && !isGifMode) ? '-' : estimatedSize();
  const sizeLabelPrefix = isVideoMode && isWebCodecsEncoder && !isGifMode ? 'Target' : 'Size';
  const sizeStatLabel = isVideoMode && isWebCodecsEncoder && !isGifMode ? 'Target Size' : 'Est. Size';
  const webCodecsRateNote = rateControl === 'vbr'
    ? 'VBR is only a bitrate target. Simple shots can encode much smaller than the selected Mbps.'
    : 'CBR tries to stay closer, but browser encoders can still drift from the requested bitrate.';
  const exportModeLabel = isXmlMode
    ? 'Timeline XML'
    : isImageMode
    ? (isImageSequenceMode ? 'Image Sequence' : 'Image Frame')
    : isGifMode
      ? 'Animated GIF'
    : isVideoMode
      ? (effectiveIncludeAudio ? 'Video + Audio' : 'Video Only')
      : (includeAudio ? 'Audio Only' : 'Nothing Selected');
  const exportDisabled =
    isExporting ||
    (isImageSequenceMode && endTime <= startTime) ||
    (!isImageMode && !isXmlMode && endTime <= startTime) ||
    isAudioOnlyMode && (!includeAudio || !isAudioSupported) ||
    (isVideoMode && encoder === 'ffmpeg' && isFFmpegLoading);
  const primaryExportLabel = 'Export';
  const usesBrowserProgress = isImageSequenceMode || encoder === 'webcodecs' || encoder === 'htmlvideo';
  const audioSummaryBadges = (effectiveIncludeAudio || isAudioOnlyMode && includeAudio)
    ? [
        { label: currentAudioCodecLabel, target: 'audio-format' as const },
        { label: `${audioSampleRate / 1000} kHz`, target: 'audio-format' as const },
        { label: `${Math.round(audioBitrate / 1000)} kbps`, target: 'audio-quality' as const },
        { label: normalizeAudio ? 'Normalized' : 'Unprocessed', target: 'audio-processing' as const },
      ]
    : [];
  const summaryBadges: ExportSummaryBadge[] = isXmlMode
    ? [
        { label: exportModeLabel, target: 'basic-container' },
        { label: currentContainerLabel, target: 'basic-container' },
        { label: `${composition?.width ?? actualWidth}x${composition?.height ?? actualHeight}`, target: 'basic-output' },
        { label: `${composition?.frameRate ?? actualFps} fps`, target: 'basic-output' },
        { label: includeAudio ? 'With audio refs' : 'No audio refs', target: 'audio-section' },
      ]
    : isImageMode
    ? [
        { label: exportModeLabel, target: 'image-section' },
        { label: isImageSequenceMode ? `Sequence ${imageSequenceOutputLabel}` : 'Single frame', target: 'image-mode' },
        { label: selectedImageFormat.label, target: 'basic-container' },
        { label: `${actualWidth}x${actualHeight}`, target: 'image-resolution' },
        {
          label: isImageSequenceMode
            ? `${imageSequenceFrameCount} frames`
            : `Frame ${formatTime(playheadPosition)}`,
          target: isImageSequenceMode ? 'image-range' : 'image-section',
        },
        ...(isImageSequenceMode ? [{
          label: `${actualFps} fps`,
          target: 'image-fps' as const,
        }] : []),
        {
          label: selectedImageFormat.lossless ? 'Lossless' : `${Math.round(imageQuality * 100)}% quality`,
          target: 'image-quality',
        },
        {
          label: selectedImageFormat.supportsAlpha ? 'Alpha kept' : 'Opaque export',
          target: 'image-quality',
          warning: !selectedImageFormat.supportsAlpha,
        },
      ]
    : [
        {
          label: exportModeLabel,
          target: isVideoMode ? 'video-section' : 'audio-section',
        },
        {
          label: isVideoMode ? methodMeta.title : `Audio ${currentAudioCodecLabel}`,
          target: isVideoMode ? 'video-section' : 'audio-format',
        },
        ...(isVideoMode ? [
          { label: currentContainerLabel, target: 'basic-container' as const },
          { label: currentCodecLabel, target: 'video-codec' as const },
          { label: `${actualWidth}x${outputHeight}`, target: 'video-resolution' as const },
          { label: `${actualFps} fps`, target: 'video-fps' as const },
          {
            label: isGifMode
              ? `${gifColors} colors`
              : encoder === 'ffmpeg'
              ? (showFFmpegQualityControl ? `MJPEG Q${ffmpegQuality}` : currentCodecLabel)
              : `${(bitrate / 1_000_000).toFixed(1)} Mbps`,
            target: isGifMode
              ? 'gif-palette' as const
              : encoder === 'ffmpeg' && !showFFmpegQualityControl ? 'video-codec' as const : 'video-rate' as const,
          },
        ] : []),
        ...audioSummaryBadges,
        {
          label: `Range ${formatTime(startTime)} - ${formatTime(endTime)}`,
          target: isVideoMode ? (isGifMode ? 'gif-palette' : 'video-alpha') : 'audio-processing',
        },
        {
          label: `Duration ${formatTime(endTime - startTime)}`,
          target: isVideoMode ? (isGifMode ? 'gif-palette' : 'video-alpha') : 'audio-processing',
        },
        ...(stackedAlpha && isVideoMode && !isGifMode ? [{
          label: 'Stacked alpha',
          target: 'video-alpha' as const,
          warning: true,
        }] : []),
        {
          label: `${sizeLabelPrefix} ${estimatedSizeLabel}`,
          target: isVideoMode
            ? (isGifMode ? 'gif-palette' : isWebCodecsEncoder || showFFmpegQualityControl ? 'video-rate' : 'video-codec')
            : 'audio-quality',
          warning: true,
        },
      ];
  const showRangeInVideo = isVideoMode;
  const showRangeInAudio = isAudioOnlyMode && includeAudio;
  const quickResolutionPresets = FrameExporter.getPresetResolutions();
  const quickFrameRatePresets = [24, 30, 60];
  const gifContainerFormat = CONTAINER_FORMATS.find(({ id }) => id === 'gif');
  const videoContainerFormats = isWebCodecsEncoder && gifContainerFormat
    ? [...FrameExporter.getContainerFormats(), gifContainerFormat]
    : CONTAINER_FORMATS;
  const webQualityPresets = [
    { id: 'review', label: 'Review', detail: '8 Mbps', value: 8_000_000 },
    { id: 'standard', label: 'Standard', detail: '15 Mbps', value: 15_000_000 },
    { id: 'high', label: 'High', detail: '25 Mbps', value: 25_000_000 },
    { id: 'master', label: 'Master', detail: '50 Mbps', value: 50_000_000 },
  ] as const;
  const audioSampleRatePresets = [
    { value: 48000 as const, label: '48 kHz' },
    { value: 44100 as const, label: '44.1 kHz' },
  ] as const;
  const audioBitratePresets = [
    { value: 128000, label: '128 kbps' },
    { value: 192000, label: '192 kbps' },
    { value: 256000, label: '256 kbps' },
    { value: 320000, label: '320 kbps' },
  ] as const;
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const selectedPresetName = selectedPreset?.name ?? '';

  const handleQuickResolutionPreset = useCallback((value: string) => {
    setUseCustomResolution(false);
    handleResolutionChange(value);
  }, [handleResolutionChange, setUseCustomResolution]);

  const handleQuickFpsPreset = useCallback((value: number) => {
    setUseCustomFps(false);
    setFps(value);
  }, [setFps, setUseCustomFps]);

  const handleQuickBitratePreset = useCallback((value: number) => {
    setRateControl('vbr');
    setBitrate(value);
  }, [setBitrate, setRateControl]);

  const saveCurrentSetup = useCallback(() => {
    try {
      const suggestedName = selectedPresetName || filename || 'Export Preset';
      const nextName = window.prompt('Preset name', suggestedName);
      if (nextName === null) {
        return;
      }

      const result = savePreset(nextName);
      if (!result) {
        setSetupStatus('Preset name required');
        return;
      }

      const suffix = projectFileService.isProjectOpen() ? '' : ' (session only)';
      setSetupStatus(result.overwritten ? `Preset updated${suffix}` : `Preset saved${suffix}`);
    } catch (error) {
      log.error('Failed to save export setup', error);
      setSetupStatus('Preset save failed');
    }
  }, [filename, savePreset, selectedPresetName]);

  const updateCurrentSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const updatedPreset = updatePreset(selectedPresetId);
      if (!updatedPreset) {
        setSetupStatus('Preset not found');
        return;
      }

      const suffix = projectFileService.isProjectOpen() ? '' : ' (session only)';
      setSetupStatus(`Preset updated${suffix}`);
    } catch (error) {
      log.error('Failed to update export setup', error);
      setSetupStatus('Preset update failed');
    }
  }, [presets.length, selectedPresetId, updatePreset]);

  const loadSavedSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const loaded = loadPreset(selectedPresetId);
      setSetupStatus(loaded ? 'Preset loaded' : 'Preset not found');
    } catch (error) {
      log.error('Failed to load export setup', error);
      setSetupStatus('Preset load failed');
    }
  }, [loadPreset, presets.length, selectedPresetId]);

  const scrollToSummaryTarget = useCallback((target: ExportSummaryTarget) => {
    if (typeof document === 'undefined') {
      return;
    }

    const node = document.querySelector<HTMLElement>(`[data-export-target="${target}"]`);
    if (!node) {
      return;
    }

    node.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    const existingTimeout = summaryHighlightTimeoutsRef.current.get(node);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    node.classList.remove('export-scroll-highlight');
    void node.offsetHeight;
    node.classList.add('export-scroll-highlight');

    const timeout = window.setTimeout(() => {
      node.classList.remove('export-scroll-highlight');
      summaryHighlightTimeoutsRef.current.delete(node);
    }, 1200);

    summaryHighlightTimeoutsRef.current.set(node, timeout);
  }, []);

  const handlePrimaryExport = useCallback(() => {
    if (isXmlMode) {
      handleExportFCPXML();
      return;
    }

    if (isImageMode) {
      if (isImageSequenceMode) {
        void handleRenderImageSequence();
      } else {
        void handleRenderFrame();
      }
      return;
    }

    if (isGifMode) {
      if (encoder === 'ffmpeg') {
        void handleFFmpegExport();
      } else {
        void handleBrowserGifExport();
      }
      return;
    }

    if (!videoEnabled) {
      if (includeAudio) {
        void handleExportAudioOnly();
      }
      return;
    }

    if (isWebCodecsEncoder) {
      void handleExport();
      return;
    }

    void handleFFmpegExport();
  }, [encoder, handleBrowserGifExport, handleExport, handleExportAudioOnly, handleExportFCPXML, handleFFmpegExport, handleRenderFrame, handleRenderImageSequence, includeAudio, isGifMode, isImageMode, isImageSequenceMode, isWebCodecsEncoder, isXmlMode, videoEnabled]);

  // If neither encoder is supported, show error
  if (!webCodecsAvailable && !ffmpegAvailable) {
    return (
      <div className="export-panel">
        <div className="panel-header">
          <h3>Export</h3>
        </div>
        <div className="export-error">
          No video encoder available. WebCodecs requires Chrome 94+ or Safari 16.4+.
          FFmpeg WASM requires WebAssembly support.
        </div>
      </div>
    );
  }

  return (
    <div className="export-panel">
      {!isExporting ? (
        <div className="export-form">
          <section className="export-hero-card export-summary-sticky export-summary-badges">
            <div className="export-summary-actions">
              <div className="export-pill-row">
                {summaryBadges.map((badge) => (
                  <button
                    key={`${badge.target}-${badge.label}`}
                    type="button"
                    className={`export-pill${badge.warning ? ' export-pill-warning' : ''}`}
                    onClick={() => scrollToSummaryTarget(badge.target)}
                  >
                    {badge.label}
                  </button>
                ))}
              </div>
              <button
                className="btn export-start-btn export-summary-cta"
                onClick={handlePrimaryExport}
                disabled={exportDisabled}
              >
                {primaryExportLabel}
              </button>
            </div>
          </section>

          <div className="export-section export-command-row" data-export-target="command-bar">
            <div className="export-command-bar">
              <div className="export-command-actions">
                <div className="export-preset-picker">
                  <select
                    id="export-preset-select"
                    aria-label="Export preset"
                    value={selectedPresetId ?? ''}
                    onChange={(e) => setSelectedPresetId(e.target.value || null)}
                  >
                    <option value="">Project presets</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="export-chip" onClick={loadSavedSetup} disabled={!selectedPresetId}>
                  Load
                </button>
                <button type="button" className="export-chip" onClick={updateCurrentSetup} disabled={!selectedPresetId}>
                  Update
                </button>
                <button type="button" className="export-chip" onClick={saveCurrentSetup}>
                  Save
                </button>
              </div>
            </div>

            {setupStatus && (
              <div className="export-inline-note">
                {setupStatus}
              </div>
            )}
          </div>

          {/* Encoder Selection */}
          <div className="export-section export-workflow-section">
            <div className="export-section-header">Workflow</div>
            <div className="export-method-grid">
              {webCodecsAvailable && (
                <button
                  type="button"
                  className={`export-method-card${encoder === 'webcodecs' ? ' is-active' : ''}`}
                  onClick={() => setEncoder('webcodecs')}
                >
                  <span className="export-method-chip">Fast</span>
                  <strong>WebCodecs</strong>
                  <span>Hardware-assisted browser export for quick delivery files.</span>
                </button>
              )}
              {webCodecsAvailable && (
                <button
                  type="button"
                  className={`export-method-card${encoder === 'htmlvideo' ? ' is-active' : ''}`}
                  onClick={() => setEncoder('htmlvideo')}
                >
                  <span className="export-method-chip">Precise</span>
                  <strong>HTMLVideo</strong>
                  <span>Safer fallback when seek accuracy matters more than speed.</span>
                </button>
              )}
              {ffmpegAvailable && (
                <button
                  type="button"
                  className={`export-method-card${encoder === 'ffmpeg' ? ' is-active' : ''}`}
                  onClick={() => setEncoder('ffmpeg')}
                >
                  <span className="export-method-chip">CPU</span>
                  <strong>FFmpeg</strong>
                  <span>Intermediates, archival codecs, and NLE-friendly containers.</span>
                </button>
              )}
            </div>
            <div className="control-row export-legacy-control">
              <label>Method</label>
              <select
                value={encoder}
                onChange={(e) => setEncoder(e.target.value as EncoderType)}
              >
                {webCodecsAvailable && (
                  <option value="webcodecs">⚡ WebCodecs (Fast)</option>
                )}
                {webCodecsAvailable && (
                  <option value="htmlvideo">🎯 HTMLVideo (Precise)</option>
                )}
                {ffmpegAvailable && (
                  <option value="ffmpeg">
                    FFmpeg (CPU){!isFFmpegMultiThreaded ? ' - ST' : ''}
                  </option>
                )}
              </select>
            </div>

            {/* FFmpeg Load Button / Status */}
            {encoder === 'ffmpeg' && (
              <div className="export-status-row">
                {!isFFmpegReady ? (
                  <button
                    type="button"
                    onClick={loadFFmpeg}
                    disabled={isFFmpegLoading}
                    className="btn-small export-status-button"
                  >
                    {isFFmpegLoading ? 'Loading FFmpeg...' : 'Load FFmpeg Runtime'}
                  </button>
                ) : (
                  <span className="export-status-ok">
                    FFmpeg Ready
                  </span>
                )}
              </div>
            )}

            {ffmpegLoadError && encoder === 'ffmpeg' && (
              <div className="export-error export-error-inline">
                {ffmpegLoadError}
              </div>
            )}
          </div>

          <div className="export-section export-basics-section">
            <div className="export-section-header">Basics</div>

            <div className="export-channel-grid">
              <div className="export-channel-card export-basic-card">
                <div className="export-channel-head">
                  <div className="export-channel-title">
                    <span>Basic</span>
                    <strong>{displayContainerLabel}</strong>
                  </div>
                </div>

                <div className="export-field-card export-subcard" data-export-target="basic-output">
                  <div className="export-field-head">
                    <span>Output</span>
                    <strong>{displayOutputName}</strong>
                  </div>
                  <div className="control-row">
                    <label>Name</label>
                    <div className="export-input-group">
                      <input
                        type="text"
                        value={filename}
                        onChange={(e) => setFilename(e.target.value)}
                        placeholder="export"
                      />
                    </div>
                  </div>
                </div>

                <div className="export-field-card export-subcard" data-export-target="basic-container">
                  <div className="export-field-head">
                    <span>Container</span>
                    <strong>{displayContainerLabel}</strong>
                  </div>
                  <div className="export-container-groups">
                    <div className="export-container-group">
                      <span className="export-container-group-label">Video</span>
                      <div className="export-chip-row">
                        {videoContainerFormats.map((format) => (
                          <button
                            key={`video-${format.id}`}
                            type="button"
                            className={`export-chip${!isXmlMode && isVideoMode && currentContainerId === format.id ? ' is-active' : ''}`}
                            onClick={() => {
                              setSpecialContainer('none');
                              setVideoEnabled(true);
                              if (format.id === 'gif') {
                                setVisualMode('gif');
                                setIncludeAudio(false);
                                if (encoder === 'ffmpeg') {
                                  handleFFmpegContainerChange('gif');
                                }
                                return;
                              }
                              setVisualMode('video');
                              if (isWebCodecsEncoder) {
                                setContainerFormat(format.id as ContainerFormat);
                              } else {
                                handleFFmpegContainerChange(format.id as FFmpegContainer);
                              }
                            }}
                          >
                            .{format.id}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-container-group">
                      <span className="export-container-group-label">Image</span>
                      <div className="export-chip-row">
                        {IMAGE_FORMATS.map((format) => (
                          <button
                            key={`image-${format.id}`}
                            type="button"
                            className={`export-chip${!isXmlMode && isImageMode && imageFormat === format.id ? ' is-active' : ''}`}
                            onClick={() => {
                              setSpecialContainer('none');
                              setVideoEnabled(true);
                              setVisualMode('image');
                              setImageFormat(format.id);
                            }}
                          >
                            .{format.id}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-container-group">
                      <span className="export-container-group-label">Audio</span>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-chip${!isXmlMode && isAudioOnlyMode ? ' is-active' : ''}`}
                          onClick={() => {
                            setSpecialContainer('none');
                            setVideoEnabled(false);
                            setIncludeAudio(true);
                          }}
                          disabled={!isAudioSupported}
                        >
                          .{audioExtension}
                        </button>
                      </div>
                    </div>

                    <div className="export-container-group">
                      <span className="export-container-group-label">XML</span>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-chip${isXmlMode ? ' is-active' : ''}`}
                          onClick={() => {
                            setSpecialContainer('xml');
                            setVideoEnabled(true);
                          }}
                        >
                          .fcpxml
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {isVideoMode ? (
                  <div className="export-field-card export-subcard" data-export-target="basic-workflow">
                    <div className="export-field-head">
                      <span>Workflow</span>
                      <strong>{methodMeta.title}</strong>
                    </div>
                    <div className="export-chip-row">
                      {webCodecsAvailable && (
                        <button
                          type="button"
                          className={`export-chip${encoder === 'webcodecs' ? ' is-active' : ''}`}
                          onClick={() => setEncoder('webcodecs')}
                        >
                          WebCodecs
                        </button>
                      )}
                      {webCodecsAvailable && (
                        <button
                          type="button"
                          className={`export-chip${encoder === 'htmlvideo' ? ' is-active' : ''}`}
                          onClick={() => setEncoder('htmlvideo')}
                        >
                          HTMLVideo
                        </button>
                      )}
                      {ffmpegAvailable && (
                        <button
                          type="button"
                          className={`export-chip${encoder === 'ffmpeg' ? ' is-active' : ''}`}
                          onClick={() => setEncoder('ffmpeg')}
                        >
                          FFmpeg
                        </button>
                      )}
                    </div>

                    {encoder === 'ffmpeg' && (
                      <div className="export-status-row">
                        {!isFFmpegReady ? (
                          <button
                            type="button"
                            onClick={loadFFmpeg}
                            disabled={isFFmpegLoading}
                            className="btn-small export-status-button"
                          >
                            {isFFmpegLoading ? 'Loading FFmpeg...' : 'Load FFmpeg Runtime'}
                          </button>
                        ) : (
                          <span className="export-status-ok">
                            FFmpeg Ready
                          </span>
                        )}
                      </div>
                    )}

                    {ffmpegLoadError && encoder === 'ffmpeg' && (
                      <div className="export-error export-error-inline">
                        {ffmpegLoadError}
                      </div>
                    )}
                  </div>
                ) : isXmlMode ? (
                  <div className="export-inline-note">
                    XML export writes a Final Cut Pro interchange file from the current timeline instead of rendering media.
                  </div>
                ) : isImageMode ? (
                  <div className="export-inline-note">
                    {isImageSequenceMode
                      ? imageSequenceFolderSupported
                        ? 'Image sequence export writes numbered frames into a selected folder.'
                        : 'Image sequence export uses a ZIP fallback because folder writes are not available in this browser.'
                      : 'Image export renders exactly one frame at the current playhead position.'}
                  </div>
                ) : isAudioOnlyMode ? (
                  <div className="export-inline-note">
                    Audio-only export uses the detected browser codec.
                  </div>
                ) : null}
              </div>

              <div className={`export-channel-card${!isXmlMode && videoEnabled ? '' : ' is-disabled'}`} data-export-target={isImageMode ? 'image-section' : 'video-section'}>
                <div className="export-channel-head">
                  <div className="export-channel-title">
                    <span>{isXmlMode ? 'XML' : isImageMode ? 'Image' : 'Video'}</span>
                    <strong>{isXmlMode ? 'Timeline interchange' : videoEnabled ? `${actualWidth}x${outputHeight}` : 'Disabled'}</strong>
                  </div>
                  {isXmlMode ? (
                    <span className="export-chip export-chip-static">FCPXML</span>
                  ) : (
                    <button
                      type="button"
                      className={`export-toggle${videoEnabled ? ' is-active' : ''}`}
                      onClick={() => {
                        if (videoEnabled) {
                          setVideoEnabled(false);
                          return;
                        }
                        setSpecialContainer('none');
                        setVideoEnabled(true);
                        setVisualMode('video');
                      }}
                    >
                      {videoEnabled ? 'On' : 'Off'}
                    </button>
                  )}
                </div>

                {isXmlMode ? (
                  <div className="export-inline-note">
                    XML export uses the current timeline structure and clip references. Render-specific video settings do not apply here.
                  </div>
                ) : isImageMode ? (
                  <>
                    <div className="export-quick-grid export-quick-grid-stack">
                      <div className="export-field-card export-subcard" data-export-target="image-mode">
                        <div className="export-field-head">
                          <span>Mode</span>
                          <strong>{isImageSequenceMode ? `Sequence ${imageSequenceOutputLabel}` : 'Single frame'}</strong>
                        </div>
                        <div className="export-chip-row">
                          <button
                            type="button"
                            className={`export-chip${imageExportMode === 'frame' ? ' is-active' : ''}`}
                            onClick={() => setImageExportMode('frame')}
                          >
                            Frame
                          </button>
                          <button
                            type="button"
                            className={`export-chip${imageExportMode === 'sequence' ? ' is-active' : ''}`}
                            onClick={() => setImageExportMode('sequence')}
                          >
                            Sequence
                          </button>
                        </div>
                      </div>

                      <div className="export-field-card export-subcard" data-export-target="image-resolution">
                        <div className="export-field-head">
                          <span>Resolution</span>
                          <strong>{actualWidth}x{actualHeight}</strong>
                        </div>
                        <div className="export-chip-row">
                          {quickResolutionPresets.map(({ label, width: presetWidth, height: presetHeight }) => (
                            <button
                              key={`${presetWidth}x${presetHeight}`}
                              type="button"
                              className={`export-chip${!useCustomResolution && width === presetWidth && height === presetHeight ? ' is-active' : ''}`}
                              onClick={() => handleQuickResolutionPreset(`${presetWidth}x${presetHeight}`)}
                            >
                              {label.split(' ')[0]}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`export-chip${useCustomResolution ? ' is-active' : ''}`}
                            onClick={() => setUseCustomResolution(true)}
                          >
                            Custom
                          </button>
                        </div>
                        {useCustomResolution && (
                          <div className="export-inline-inputs">
                            <input
                              type="number"
                              value={customWidth}
                              onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                              placeholder="Width"
                              min="1"
                              max="7680"
                            />
                            <span>x</span>
                            <input
                              type="number"
                              value={customHeight}
                              onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                              placeholder="Height"
                              min="1"
                              max="4320"
                            />
                          </div>
                        )}
                      </div>

                      <div className="export-field-card export-subcard" data-export-target="image-quality">
                        <div className="export-field-head">
                          <span>Quality</span>
                          <strong>{selectedImageFormat.lossless ? 'Lossless' : `${Math.round(imageQuality * 100)}%`}</strong>
                        </div>
                        <div className="export-chip-row">
                          <span className="export-chip export-chip-static">
                            {selectedImageFormat.supportsAlpha ? 'Alpha kept' : 'Opaque'}
                          </span>
                          {!selectedImageFormat.lossless && IMAGE_QUALITY_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={`export-chip${Math.abs(imageQuality - preset.value) < 0.001 ? ' is-active' : ''}`}
                              onClick={() => setImageQuality(preset.value)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        {!selectedImageFormat.lossless && (
                          <div className="export-slider-control">
                            <div className="export-slider-head">
                              <label>Fine Tune</label>
                              <span className="export-slider-value">{Math.round(imageQuality * 100)}%</span>
                            </div>
                            <input
                              className="export-slider-input"
                              type="range"
                              min={0.4}
                              max={1}
                              step={0.01}
                              value={imageQuality}
                              onChange={(e) => setImageQuality(Number(e.target.value))}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {isImageSequenceMode ? (
                      <>
                        <div className="export-field-card export-subcard" data-export-target="image-fps">
                          <div className="export-field-head">
                            <span>Frame Rate</span>
                            <strong>{actualFps} fps</strong>
                          </div>
                          <div className="export-chip-row">
                            {[24, 25, 30, 60].map((presetFps) => (
                              <button
                                key={`image-sequence-fps-${presetFps}`}
                                type="button"
                                className={`export-chip${!useCustomFps && fps === presetFps ? ' is-active' : ''}`}
                                onClick={() => {
                                  setUseCustomFps(false);
                                  setFps(presetFps);
                                }}
                              >
                                {presetFps}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={`export-chip${useCustomFps ? ' is-active' : ''}`}
                              onClick={() => setUseCustomFps(true)}
                            >
                              Custom
                            </button>
                          </div>
                          {useCustomFps && (
                            <div className="export-inline-inputs">
                              <input
                                type="number"
                                value={customFps}
                                onChange={(e) => setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                                min={1}
                                max={240}
                                step={0.001}
                              />
                              <span>fps</span>
                            </div>
                          )}
                        </div>

                        <div className="export-field-card export-subcard" data-export-target="image-range">
                          <div className="export-field-head">
                            <span>Sequence</span>
                            <strong>{imageSequenceFrameCount} frames</strong>
                          </div>
                          <div className="export-chip-row">
                            <button
                              type="button"
                              className={`export-chip${useInOut ? ' is-active' : ''}`}
                              onClick={() => setUseInOut(!useInOut)}
                            >
                              Use In/Out
                            </button>
                            <span className="export-chip export-chip-static">{imageSequenceOutputLabel}</span>
                          </div>
                          <div className="export-inline-note">
                            Range {formatTime(startTime)} - {formatTime(endTime)} saved as numbered .{imageFormat} files.
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="export-field-card export-subcard">
                        <div className="export-field-head">
                          <span>Frame</span>
                          <strong>{formatTime(playheadPosition)}</strong>
                        </div>
                        <div className="export-inline-note">
                          Exports the exact composited frame currently under the playhead.
                        </div>
                      </div>
                    )}
                  </>
                ) : videoEnabled ? (
                  <>
                    <div className="export-quick-grid">
                      <div className="export-field-card export-subcard" data-export-target="video-resolution">
                        <div className="export-field-head">
                          <span>Resolution</span>
                          <strong>{actualWidth}x{actualHeight}</strong>
                        </div>
                        <div className="export-chip-row">
                          {quickResolutionPresets.map(({ label, width: presetWidth, height: presetHeight }) => (
                            <button
                              key={`${presetWidth}x${presetHeight}`}
                              type="button"
                              className={`export-chip${!useCustomResolution && width === presetWidth && height === presetHeight ? ' is-active' : ''}`}
                              onClick={() => handleQuickResolutionPreset(`${presetWidth}x${presetHeight}`)}
                            >
                              {label.split(' ')[0]}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`export-chip${useCustomResolution ? ' is-active' : ''}`}
                            onClick={() => setUseCustomResolution(true)}
                          >
                            Custom
                          </button>
                        </div>
                        {useCustomResolution && (
                          <div className="export-inline-inputs">
                            <input
                              type="number"
                              value={customWidth}
                              onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                              placeholder="Width"
                              min="1"
                              max="7680"
                            />
                            <span>x</span>
                            <input
                              type="number"
                              value={customHeight}
                              onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                              placeholder="Height"
                              min="1"
                              max="4320"
                            />
                          </div>
                        )}
                      </div>

                      <div className="export-field-card export-subcard" data-export-target="video-fps">
                        <div className="export-field-head">
                          <span>Frame Rate</span>
                          <strong>{actualFps} fps</strong>
                        </div>
                        <div className="export-chip-row">
                          {quickFrameRatePresets.map((presetFps) => (
                            <button
                              key={presetFps}
                              type="button"
                              className={`export-chip${!useCustomFps && fps === presetFps ? ' is-active' : ''}`}
                              onClick={() => handleQuickFpsPreset(presetFps)}
                            >
                              {presetFps} fps
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`export-chip${useCustomFps ? ' is-active' : ''}`}
                            onClick={() => setUseCustomFps(true)}
                          >
                            Custom
                          </button>
                        </div>
                        {useCustomFps && (
                          <div className="export-inline-inputs export-inline-inputs-single">
                            <input
                              type="number"
                              value={customFps}
                              onChange={(e) => setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                              min={1}
                              max={240}
                              step={0.001}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {(isGifMode || isWebCodecsEncoder || showFFmpegQualityControl) && (
                    <div className="export-field-card export-subcard" data-export-target={isGifMode ? 'gif-palette' : 'video-rate'}>
                      <div className="export-field-head">
                        <span>{isGifMode ? 'Palette' : isWebCodecsEncoder ? 'Rate' : 'Quality'}</span>
                        <strong>
                          {isGifMode
                            ? `${gifColors} colors / ${getGifPaletteModeLabel(gifPaletteMode)}`
                            : isWebCodecsEncoder
                            ? `${rateControl.toUpperCase()} / ${(bitrate / 1_000_000).toFixed(1)} Mbps`
                            : `MJPEG / Q${ffmpegQuality}`}
                        </strong>
                      </div>
                      {isGifMode ? (
                        <>
                          <div className="export-chip-row">
                            {GIF_COLOR_PRESETS.map((value) => (
                              <button
                                key={value}
                                type="button"
                                className={`export-chip${gifColors === value ? ' is-active' : ''}`}
                                onClick={() => setGifColors(value)}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                          <div className="export-chip-row">
                            {GIF_PALETTE_MODES.map((mode) => (
                              <button
                                key={mode.id}
                                type="button"
                                className={`export-chip${gifPaletteMode === mode.id ? ' is-active' : ''}`}
                                onClick={() => setGifPaletteMode(mode.id)}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                          <div className="export-chip-row">
                            {GIF_DITHER_OPTIONS.map((dither) => (
                              <button
                                key={dither.id}
                                type="button"
                                className={`export-chip${gifDither === dither.id ? ' is-active' : ''}`}
                                onClick={() => setGifDither(dither.id)}
                                disabled={isWebCodecsEncoder}
                              >
                                {dither.label}
                              </button>
                            ))}
                          </div>
                          <div className="export-chip-row">
                            <button
                              type="button"
                              className={`export-toggle${gifLoop === 'forever' ? ' is-active' : ''}`}
                              onClick={() => setGifLoop(gifLoop === 'forever' ? 'once' : 'forever')}
                            >
                              {gifLoop === 'forever' ? 'Loop Forever' : 'Play Once'}
                            </button>
                            <button
                              type="button"
                              className={`export-toggle${gifOptimize ? ' is-active' : ''}`}
                              onClick={() => setGifOptimize(!gifOptimize)}
                              disabled={isWebCodecsEncoder}
                            >
                              Optimize
                            </button>
                          </div>
                          <div className="export-slider-control">
                            <div className="export-slider-head">
                              <label>Alpha Threshold</label>
                              <span className="export-slider-value">{gifAlphaThreshold}</span>
                            </div>
                            <input
                              className="export-slider-input"
                              type="range"
                              min={0}
                              max={255}
                              step={1}
                              value={gifAlphaThreshold}
                              onChange={(e) => setGifAlphaThreshold(Number(e.target.value))}
                            />
                          </div>
                          <div className="export-inline-note">
                            Estimated range: {gifSizeRangeLabel}. {isWebCodecsEncoder ? 'Browser GIF uses fast quantization without dithering.' : `Dither: ${getGifDitherLabel(gifDither)}.`}
                          </div>
                        </>
                      ) : isWebCodecsEncoder ? (
                        <>
                          <div className="export-chip-row">
                            <button
                              type="button"
                              className={`export-chip${rateControl === 'vbr' ? ' is-active' : ''}`}
                              onClick={() => setRateControl('vbr')}
                            >
                              VBR
                            </button>
                            <button
                              type="button"
                              className={`export-chip${rateControl === 'cbr' ? ' is-active' : ''}`}
                              onClick={() => setRateControl('cbr')}
                            >
                              CBR
                            </button>
                          </div>
                          <div className="export-chip-row">
                            {webQualityPresets.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className={`export-chip${bitrate === preset.value ? ' is-active' : ''}`}
                                onClick={() => handleQuickBitratePreset(preset.value)}
                              >
                                {preset.detail}
                              </button>
                            ))}
                          </div>
                          <div className="export-slider-control">
                            <div className="export-slider-head">
                              <label>Fine Tune</label>
                              <span className="export-slider-value">{(bitrate / 1_000_000).toFixed(1)} Mbps</span>
                            </div>
                            <input
                              className="export-slider-input"
                              type="range"
                              min={1_000_000}
                              max={100_000_000}
                              step={500_000}
                              value={bitrate}
                              onChange={(e) => setBitrate(Number(e.target.value))}
                            />
                          </div>
                          <div className="export-inline-note">
                            {webCodecsRateNote}
                          </div>
                        </>
                      ) : (
                        <div className="export-slider-control">
                          <div className="export-slider-head">
                            <label>MJPEG</label>
                            <span className="export-slider-value">
                              {ffmpegQuality} {ffmpegQuality <= 5 ? '(High)' : ffmpegQuality <= 10 ? '(Good)' : ffmpegQuality <= 20 ? '(Med)' : '(Low)'}
                            </span>
                          </div>
                          <input
                            className="export-slider-input"
                            type="range"
                            min={1}
                            max={31}
                            value={ffmpegQuality}
                            onChange={(e) => setFfmpegQuality(parseInt(e.target.value))}
                          />
                        </div>
                      )}
                    </div>
                    )}

                    <div className="export-field-card export-subcard" data-export-target="video-codec">
                      <div className="export-field-head">
                        <span>Codec</span>
                        <strong>{currentCodecLabel}</strong>
                      </div>
                      <div className="export-chip-row">
                        {isGifMode ? (
                          <span className="export-chip export-chip-static">
                            {encoder === 'ffmpeg' ? 'FFmpeg palette' : 'Browser encoder'}
                          </span>
                        ) : isWebCodecsEncoder
                          ? FrameExporter.getVideoCodecs(containerFormat).map(({ id, label }) => (
                              <button
                                key={id}
                                type="button"
                                className={`export-chip${videoCodec === id ? ' is-active' : ''}`}
                                onClick={() => setVideoCodec(id as VideoCodec)}
                                disabled={!codecSupport[id]}
                              >
                                {label}
                              </button>
                            ))
                          : getCodecsForContainer(ffmpegContainer).map((codec) => (
                              <button
                                key={codec.id}
                                type="button"
                                className={`export-chip${ffmpegCodec === codec.id ? ' is-active' : ''}`}
                                onClick={() => handleFFmpegCodecChange(codec.id as FFmpegVideoCodec)}
                              >
                                {codec.name}
                              </button>
                            ))}
                      </div>

                      {(encoder === 'ffmpeg' || isGifMode) && ffmpegCodecInfo && (
                        <div className="export-inline-note">
                          {ffmpegCodecInfo.description}
                          {ffmpegCodecInfo.supportsAlpha && ' | Alpha'}
                          {ffmpegCodecInfo.supports10bit && ' | 10-bit'}
                        </div>
                      )}

                      {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'prores' && (
                        <div className="export-chip-row">
                          {PRORES_PROFILES.map((profile) => (
                            <button
                              key={profile.id}
                              type="button"
                              className={`export-chip${proresProfile === profile.id ? ' is-active' : ''}`}
                              onClick={() => setProresProfile(profile.id as ProResProfile)}
                            >
                              {profile.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'dnxhd' && (
                        <div className="export-chip-row">
                          {DNXHR_PROFILES.map((profile) => (
                            <button
                              key={profile.id}
                              type="button"
                              className={`export-chip${dnxhrProfile === profile.id ? ' is-active' : ''}`}
                              onClick={() => setDnxhrProfile(profile.id as DnxhrProfile)}
                            >
                              {profile.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="export-field-card export-subcard" data-export-target="video-alpha">
                      <div className="export-field-head">
                        <span>{isGifMode ? 'Transparency' : 'Alpha'}</span>
                        <strong>{isGifMode ? `Threshold ${gifAlphaThreshold}` : stackedAlpha ? 'Stacked' : 'Off'}</strong>
                      </div>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-toggle${stackedAlpha ? ' is-active' : ''}`}
                          onClick={() => setStackedAlpha(!stackedAlpha)}
                          disabled={!isWebCodecsEncoder || isGifMode}
                        >
                          Stacked Alpha
                        </button>
                        {showRangeInVideo && (
                          <button
                            type="button"
                            className={`export-toggle${useInOut ? ' is-active' : ''}`}
                            onClick={() => setUseInOut(!useInOut)}
                          >
                            Use In/Out
                          </button>
                        )}
                      </div>
                      {stackedAlpha && !isGifMode && (
                        <div className="export-inline-note export-inline-note-warning">
                          Output becomes {actualWidth}x{actualHeight * 2}. Top half is RGB, bottom half is alpha as grayscale.
                        </div>
                      )}
                      {showRangeInVideo && (
                        <div className="export-stats-grid export-stats-grid-compact">
                          <div className="export-stat-card">
                            <span>Output</span>
                            <strong>{actualWidth}x{outputHeight}</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>Frames</span>
                            <strong>{frameCount}</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>{sizeStatLabel}</span>
                            <strong>{estimatedSizeLabel}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="export-inline-note">
                    Visual export is disabled. Switch to Video or Image, or use Audio-only export.
                  </div>
                )}
              </div>

              <div className={`export-channel-card${isImageMode || isGifMode || (!includeAudio && !isXmlMode) ? ' is-disabled' : ''}`} data-export-target="audio-section">
                <div className="export-channel-head">
                  <div className="export-channel-title">
                    <span>Audio</span>
                    <strong>{isGifMode ? 'Not supported' : isXmlMode ? (includeAudio ? 'Track references included' : 'No audio references') : !isImageMode && includeAudio ? `${currentAudioCodecLabel} / ${audioSampleRate / 1000} kHz` : 'Disabled'}</strong>
                  </div>
                  <button
                    type="button"
                    className={`export-toggle${!isGifMode && (isXmlMode ? includeAudio : !isImageMode && includeAudio) ? ' is-active' : ''}`}
                    onClick={() => setIncludeAudio(!includeAudio)}
                    disabled={isImageMode || isGifMode || (!isXmlMode && isWebCodecsEncoder && !isAudioSupported)}
                  >
                    {!isGifMode && (isXmlMode ? includeAudio : !isImageMode && includeAudio) ? 'On' : 'Off'}
                  </button>
                </div>

                {isImageMode ? (
                  <div className="export-inline-note">
                    Image export ignores audio and renders only the current playhead frame.
                  </div>
                ) : isGifMode ? (
                  <div className="export-inline-note">
                    GIF export is silent.
                  </div>
                ) : isXmlMode ? (
                  <div className="export-inline-note">
                    XML export can include or omit audio track references, but it does not encode audio files.
                  </div>
                ) : includeAudio ? (
                  <>
                    <div className="export-field-card export-subcard" data-export-target="audio-format">
                      <div className="export-field-head">
                        <span>Format</span>
                        <strong>{currentAudioCodecLabel}</strong>
                      </div>
                      <div className="export-chip-row">
                        <span className="export-chip export-chip-static">
                          {currentAudioCodecLabel}{videoEnabled && encoder === 'ffmpeg' ? ' auto' : ''}
                        </span>
                        {audioSampleRatePresets.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`export-chip${audioSampleRate === preset.value ? ' is-active' : ''}`}
                            onClick={() => setAudioSampleRate(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-field-card export-subcard" data-export-target="audio-quality">
                      <div className="export-field-head">
                        <span>Quality</span>
                        <strong>{Math.round(audioBitrate / 1000)} kbps</strong>
                      </div>
                      <div className="export-chip-row">
                        {audioBitratePresets.map((preset) => (
                          <button
                            type="button"
                            key={preset.value}
                            className={`export-chip${audioBitrate === preset.value ? ' is-active' : ''}`}
                            onClick={() => setAudioBitrate(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-field-card export-subcard" data-export-target="audio-processing">
                      <div className="export-field-head">
                        <span>Processing</span>
                        <strong>{normalizeAudio ? 'Normalized' : 'Direct'}</strong>
                      </div>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-toggle${normalizeAudio ? ' is-active' : ''}`}
                          onClick={() => setNormalizeAudio(!normalizeAudio)}
                        >
                          Normalize
                        </button>
                        {showRangeInAudio && (
                          <button
                            type="button"
                            className={`export-toggle${useInOut ? ' is-active' : ''}`}
                            onClick={() => setUseInOut(!useInOut)}
                          >
                            Use In/Out
                          </button>
                        )}
                      </div>

                      {isWebCodecsEncoder && !isAudioSupported && (
                        <div className="export-inline-note export-inline-note-warning">
                          Browser audio encoding is not available here. Video export still works.
                        </div>
                      )}

                      {showRangeInAudio && (
                        <div className="export-stats-grid export-stats-grid-compact">
                          <div className="export-stat-card">
                            <span>Output</span>
                            <strong>{currentAudioCodecLabel} only</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>Duration</span>
                            <strong>{formatTime(endTime - startTime)}</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>{sizeStatLabel}</span>
                            <strong>{estimatedSizeLabel}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="export-inline-note">
                    Audio export is disabled. Video export stays silent until you turn audio back on.
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Video Settings */}
          <div className="export-section export-advanced-section">
            <div className="export-section-header">Advanced Video</div>

            {/* Filename */}
            <div className="control-row">
              <label>Filename</label>
              <div className="export-input-group">
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="export"
                />
                <select
                  className="export-extension-select"
                  value={currentContainerId}
                  onChange={(e) => {
                    const nextContainer = e.target.value;
                    if (nextContainer === 'gif') {
                      setSpecialContainer('none');
                      setVideoEnabled(true);
                      setVisualMode('gif');
                      setIncludeAudio(false);
                    } else if (isWebCodecsEncoder) {
                      setVisualMode('video');
                      setContainerFormat(nextContainer as ContainerFormat);
                    } else {
                      setVisualMode('video');
                      handleFFmpegContainerChange(nextContainer as FFmpegContainer);
                    }
                  }}
                  title="Click to change container format"
                >
                  {videoContainerFormats.map(({ id }) => (
                    <option key={id} value={id}>.{id}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Video Codec */}
            <div className="control-row">
              <label>Codec</label>
              {isGifMode ? (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {currentCodecLabel}
                </span>
              ) : (encoder === 'webcodecs' || encoder === 'htmlvideo') ? (
                <select
                  value={videoCodec}
                  onChange={(e) => setVideoCodec(e.target.value as VideoCodec)}
                >
                  {FrameExporter.getVideoCodecs(containerFormat).map(({ id, label }) => (
                    <option key={id} value={id} disabled={!codecSupport[id]}>
                      {label} {!codecSupport[id] ? '(not supported)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <CodecSelector
                  container={ffmpegContainer}
                  value={ffmpegCodec}
                  onChange={handleFFmpegCodecChange}
                />
              )}
            </div>

            {/* FFmpeg Codec description */}
            {(encoder === 'ffmpeg' || isGifMode) && ffmpegCodecInfo && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '-4px', marginBottom: '8px', paddingLeft: '4px' }}>
                {ffmpegCodecInfo.description}
                {ffmpegCodecInfo.supportsAlpha && ' | Alpha'}
                {ffmpegCodecInfo.supports10bit && ' | 10-bit'}
              </div>
            )}

            {/* FFmpeg ProRes Profile */}
            {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'prores' && (
              <div className="control-row">
                <label>Profile</label>
                <select
                  value={proresProfile}
                  onChange={(e) => setProresProfile(e.target.value as ProResProfile)}
                >
                  {PRORES_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* FFmpeg DNxHR Profile */}
            {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'dnxhd' && (
              <div className="control-row">
                <label>Profile</label>
                <select
                  value={dnxhrProfile}
                  onChange={(e) => setDnxhrProfile(e.target.value as DnxhrProfile)}
                >
                  {DNXHR_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* HAP codec removed - requires snappy which doesn't build with ASYNCIFY */}

            {/* Resolution */}
            <div className="control-row">
              <label>Resolution</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={useCustomResolution ? 'custom' : `${width}x${height}`}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setUseCustomResolution(true);
                    } else {
                      setUseCustomResolution(false);
                      handleResolutionChange(e.target.value);
                    }
                  }}
                  disabled={useCustomResolution}
                  style={{ flex: 1 }}
                >
                  {FrameExporter.getPresetResolutions().map(({ label, width: w, height: h }) => (
                    <option key={`${w}x${h}`} value={`${w}x${h}`}>
                      {label}
                    </option>
                  ))}
                  <option value="custom">Custom...</option>
                </select>
                <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={useCustomResolution}
                    onChange={(e) => setUseCustomResolution(e.target.checked)}
                  />
                  Custom
                </label>
              </div>
            </div>

            {/* Custom Resolution Inputs */}
            {useCustomResolution && (
              <div className="control-row">
                <label>Custom Size</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                    placeholder="Width"
                    min="1"
                    max="7680"
                    style={{ flex: 1 }}
                  />
                  <span>×</span>
                  <input
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                    placeholder="Height"
                    min="1"
                    max="4320"
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            )}

            {/* Frame Rate */}
            <div className="control-row">
              <label>Frame Rate</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {!useCustomFps ? (
                  <select
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    style={{ flex: 1 }}
                  >
                    <option value={23.976}>23.976 fps (Film)</option>
                    <option value={24}>24 fps (Cinema)</option>
                    <option value={25}>25 fps (PAL)</option>
                    <option value={29.97}>29.97 fps (NTSC)</option>
                    <option value={30}>30 fps</option>
                    <option value={48}>48 fps (HFR)</option>
                    <option value={50}>50 fps (PAL)</option>
                    <option value={59.94}>59.94 fps (NTSC)</option>
                    <option value={60}>60 fps</option>
                    <option value={120}>120 fps</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    value={customFps}
                    onChange={(e) => setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                    min={1}
                    max={240}
                    step={0.001}
                    style={{ flex: 1 }}
                  />
                )}
                <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={useCustomFps}
                    onChange={(e) => setUseCustomFps(e.target.checked)}
                  />
                  Custom
                </label>
              </div>
            </div>

            {/* Quality - different controls for each encoder */}
            {isGifMode ? (
              <div className="control-row">
                <label>GIF Palette</label>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {gifColors} colors, {getGifPaletteModeLabel(gifPaletteMode)}, {estimatedSizeLabel}
                </span>
              </div>
            ) : (encoder === 'webcodecs' || encoder === 'htmlvideo') ? (
              <>
                {/* Rate Control */}
                <div className="control-row">
                  <label>Rate Control</label>
                  <select
                    value={rateControl}
                    onChange={(e) => setRateControl(e.target.value as 'vbr' | 'cbr')}
                  >
                    <option value="vbr">VBR (Variable Bitrate)</option>
                    <option value="cbr">CBR (Constant Bitrate)</option>
                  </select>
                </div>

                {/* Bitrate */}
                <div className="control-row">
                  <label>{rateControl === 'cbr' ? 'Bitrate' : 'Target Bitrate'}</label>
                  <select
                    value={bitrate}
                    onChange={(e) => setBitrate(Number(e.target.value))}
                  >
                    <option value={5_000_000}>5 Mbps (Low)</option>
                    <option value={10_000_000}>10 Mbps (Medium)</option>
                    <option value={15_000_000}>15 Mbps (High)</option>
                    <option value={20_000_000}>20 Mbps</option>
                    <option value={25_000_000}>25 Mbps (Very High)</option>
                    <option value={35_000_000}>35 Mbps</option>
                    <option value={50_000_000}>50 Mbps (Max)</option>
                  </select>
                </div>

                {/* Bitrate Slider */}
                <div className="control-row">
                  <label></label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
                    <input
                      type="range"
                      min={1_000_000}
                      max={100_000_000}
                      step={500_000}
                      value={bitrate}
                      onChange={(e) => setBitrate(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ minWidth: '70px', fontSize: '12px', textAlign: 'right' }}>
                      {(bitrate / 1_000_000).toFixed(1)} Mbps
                    </span>
                  </div>
                </div>
              </>
            ) : showFFmpegQualityControl && (
              /* MJPEG Quality Control - lower values = higher quality */
              <div className="control-row">
                <label>Quality</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <input
                    type="range"
                    min={1}
                    max={31}
                    value={ffmpegQuality}
                    onChange={(e) => setFfmpegQuality(parseInt(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: '60px', textAlign: 'right', fontSize: '12px' }}>
                    {ffmpegQuality} {ffmpegQuality <= 5 ? '(High)' : ffmpegQuality <= 10 ? '(Good)' : ffmpegQuality <= 20 ? '(Med)' : '(Low)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Audio Settings */}
          <div className="export-section export-advanced-section">
            <div className="export-section-header">Advanced Audio</div>

            <div className="control-row">
              <label>
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    disabled={isGifMode || ((encoder === 'webcodecs' || encoder === 'htmlvideo') && !isAudioSupported)}
                  />
                  Include Audio
                </label>
              {isGifMode && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px', marginLeft: '8px' }}>
                  GIF is silent
                </span>
              )}
              {(encoder === 'webcodecs' || encoder === 'htmlvideo') && !isAudioSupported && (
                <span style={{ color: 'var(--warning)', fontSize: '11px', marginLeft: '8px' }}>
                  Not supported
                </span>
              )}
            </div>

            {includeAudio && !isGifMode && (
              <>
                <div className="control-row">
                  <label>Sample Rate</label>
                  <select
                    value={audioSampleRate}
                    onChange={(e) => setAudioSampleRate(Number(e.target.value) as 44100 | 48000)}
                  >
                    <option value={48000}>48 kHz (Video)</option>
                    <option value={44100}>44.1 kHz (CD)</option>
                  </select>
                </div>

                <div className="control-row">
                  <label>Audio Quality</label>
                  <select
                    value={audioBitrate}
                    onChange={(e) => setAudioBitrate(Number(e.target.value))}
                  >
                    <option value={128000}>128 kbps</option>
                    <option value={192000}>192 kbps</option>
                    <option value={256000}>256 kbps (High)</option>
                    <option value={320000}>320 kbps (Max)</option>
                  </select>
                </div>

                {encoder === 'ffmpeg' && (
                  <div className="control-row">
                    <label>Audio Codec</label>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {ffmpegContainer === 'mov' ? 'AAC' :
                       ffmpegContainer === 'mkv' ? 'FLAC' :
                       ffmpegContainer === 'avi' ? 'PCM' :
                       ffmpegContainer === 'mxf' ? 'PCM' : 'AAC'} (auto)
                    </span>
                  </div>
                )}

                <div className="control-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={normalizeAudio}
                      onChange={(e) => setNormalizeAudio(e.target.checked)}
                    />
                    Normalize (prevent clipping)
                  </label>
                </div>
              </>
            )}
          </div>

          {/* Alpha Settings */}
          {(encoder === 'webcodecs' || encoder === 'htmlvideo') && !isGifMode && (
            <div className="export-section export-advanced-section">
              <div className="export-section-header">Advanced Alpha</div>

              <div className="control-row">
                <label>
                  <input
                    type="checkbox"
                    checked={stackedAlpha}
                    onChange={(e) => setStackedAlpha(e.target.checked)}
                  />
                  Stacked Alpha (transparent video)
                </label>
              </div>

              {stackedAlpha && (
                <div style={{
                  padding: '8px 10px',
                  background: 'rgba(255, 170, 0, 0.1)',
                  border: '1px solid rgba(255, 170, 0, 0.3)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--warning, #ffaa00)',
                  lineHeight: 1.4,
                }}>
                  Output: {actualWidth}x{actualHeight * 2}px (doubled height).
                  Top half = RGB, bottom half = alpha as grayscale.
                </div>
              )}
            </div>
          )}

          {/* Range Settings */}
          <div className="export-section export-advanced-section">
            <div className="export-section-header">Range & Summary</div>

            <div className="control-row">
              <label>
                <input
                  type="checkbox"
                  checked={useInOut}
                  onChange={(e) => setUseInOut(e.target.checked)}
                />
                Use In/Out Markers
              </label>
            </div>

            <div className="export-summary">
              <div>Output: {actualWidth}x{outputHeight}{stackedAlpha && !isGifMode ? ' (stacked alpha)' : ''}</div>
              <div>Range: {formatTime(startTime)} - {formatTime(endTime)}</div>
              <div>Duration: {formatTime(endTime - startTime)}</div>
              <div>Frames: {frameCount}</div>
              <div>Est. Size: {estimatedSizeLabel}</div>
            </div>
          </div>

          {error && <div className="export-error">{error}</div>}
        </div>
      ) : (
        <div className="export-progress-container">
          {/* Phase indicator */}
          <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
            {usesBrowserProgress ? (
              <>
                {progress?.phase === 'video' && (
                  isImageSequenceMode
                    ? 'Rendering image sequence...'
                    : isGifMode
                      ? 'Encoding GIF frames...'
                      : 'Encoding video frames...'
                )}
                {progress?.phase === 'audio' && (
                  <>Processing audio: {progress.audioPhase} ({progress.audioPercent}%)</>
                )}
                {progress?.phase === 'muxing' && (isImageSequenceMode ? 'Finalizing sequence...' : 'Finalizing...')}
              </>
            ) : (
              <>
                {exportPhase === 'rendering' && 'Rendering frames...'}
                {exportPhase === 'audio' && 'Processing audio...'}
                {exportPhase === 'encoding' && (isGifMode ? 'Encoding GIF (please wait)...' : 'Encoding video (please wait)...')}
              </>
            )}
          </div>

          <div className="export-progress-bar">
            <div
              className="export-progress-fill"
              style={{
                width: `${(encoder === 'webcodecs' || encoder === 'htmlvideo')
                  ? (progress?.percent ?? 0)
                  : (ffmpegProgress?.percent ?? 0)}%`
              }}
            />
          </div>
          <div className="export-progress-info">
            {usesBrowserProgress ? (
              <>
                {progress?.phase === 'video' ? (
                  <span>Frame {progress?.currentFrame ?? 0} / {progress?.totalFrames ?? 0}</span>
                ) : progress?.phase === 'muxing' ? (
                  <span>{isImageSequenceMode ? 'Packaging sequence' : 'Finalizing'}</span>
                ) : (
                  <span>Audio processing</span>
                )}
                <span>{(progress?.percent ?? 0).toFixed(1)}%</span>
              </>
            ) : (
              <>
                <span>Frame {ffmpegProgress?.frame ?? 0}</span>
                <span>{(ffmpegProgress?.percent ?? 0).toFixed(1)}%</span>
              </>
            )}
          </div>
          {usesBrowserProgress && progress && progress.phase === 'video' && progress.estimatedTimeRemaining > 0 && (
            <div className="export-eta">
              ETA: {formatTime(progress.estimatedTimeRemaining)}
            </div>
          )}
          <button className="btn export-cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
