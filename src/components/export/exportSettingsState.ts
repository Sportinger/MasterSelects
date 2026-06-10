import { FrameExporter, RESOLUTION_PRESETS } from '../../engine/export';
import type { ContainerFormat } from '../../engine/export';
import type { AudioCodec } from '../../engine/audio';
import {
  CONTAINER_FORMATS,
  getCodecInfo,
  type FFmpegContainer,
  type FFmpegVideoCodec,
} from '../../engine/ffmpeg';
import {
  estimateGifSize,
  formatByteSize,
  type GifDither,
  type GifLoopMode,
  type GifPaletteMode,
} from '../../engine/gif/gifOptions';
import { getImageSequenceFolderName, isImageSequenceFolderExportSupported } from '../../engine/export/ImageSequenceExporter';
import type { Composition } from '../../stores/mediaStore';
import type {
  ExportAudioFormat,
  ExportImageFormat as ImageFormat,
  ExportImageMode,
  ExportPreset,
  ExportSpecialContainer,
  ExportVisualMode,
} from '../../stores/exportStore';
import type { EncoderType } from './useExportState';
import { buildSummaryBadges } from './exportSummaryState';

export const IMAGE_FORMATS: Array<{
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

export const IMAGE_QUALITY_PRESETS = [
  { id: 'draft', label: 'Draft', value: 0.72 }, { id: 'standard', label: 'Standard', value: 0.85 },
  { id: 'high', label: 'High', value: 0.92 }, { id: 'max', label: 'Max', value: 1 },
] as const;

export function formatExportTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

export interface ExportSettingsStateInput {
  composition: Composition | undefined;
  presets: ExportPreset[];
  selectedPresetId: string | null;
  durationStartTime: number;
  durationEndTime: number;
  playheadPosition: number;
  encoder: EncoderType;
  width: number;
  height: number;
  customWidth: number;
  customHeight: number;
  useCustomResolution: boolean;
  fps: number;
  customFps: number;
  useCustomFps: boolean;
  filename: string;
  bitrate: number;
  containerFormat: ContainerFormat;
  videoCodec: string;
  rateControl: 'vbr' | 'cbr';
  ffmpegCodec: FFmpegVideoCodec;
  ffmpegContainer: FFmpegContainer;
  ffmpegQuality: number;
  ffmpegBitrate: number;
  ffmpegRateControl: 'crf' | 'cbr' | 'vbr';
  gifColors: number;
  gifDither: GifDither;
  gifLoop: GifLoopMode;
  gifPaletteMode: GifPaletteMode;
  gifOptimize: boolean;
  gifAlphaThreshold: number;
  stackedAlpha: boolean;
  includeAudio: boolean;
  audioOnlyFormat: ExportAudioFormat;
  audioSampleRate: number;
  audioBitrate: number;
  normalizeAudio: boolean;
  audioCodec: AudioCodec | null;
  isAudioSupported: boolean;
  isSupported: boolean;
  isFFmpegSupported: boolean;
  isFFmpegLoading: boolean;
  isFFmpegMultiThreaded: boolean;
  videoEnabled: boolean;
  visualMode: ExportVisualMode;
  imageFormat: ImageFormat;
  imageExportMode: ExportImageMode;
  imageQuality: number;
  specialContainer: ExportSpecialContainer;
  isExporting: boolean;
}

export function buildExportSettingsState(input: ExportSettingsStateInput) {
  const actualWidth = input.useCustomResolution ? input.customWidth : input.width;
  const actualHeight = input.useCustomResolution ? input.customHeight : input.height;
  const actualFps = input.useCustomFps ? input.customFps : input.fps;
  const imageSequenceFrameCount = Math.max(
    1,
    Math.ceil(Math.max(0, input.durationEndTime - input.durationStartTime) * actualFps),
  );
  const gifSizeEstimate = estimateGifSize({
    width: actualWidth,
    height: actualHeight,
    fps: actualFps,
    durationSeconds: input.durationEndTime - input.durationStartTime,
    gifColors: input.gifColors,
    gifDither: input.gifDither,
    gifLoop: input.gifLoop,
    gifPaletteMode: input.gifPaletteMode,
    gifOptimize: input.gifOptimize,
    gifAlphaThreshold: input.gifAlphaThreshold,
  });
  const gifSizeRangeLabel = `${formatByteSize(gifSizeEstimate.minBytes)}-${formatByteSize(gifSizeEstimate.maxBytes)}`;
  const webCodecsAvailable = input.isSupported;
  const ffmpegAvailable = input.isFFmpegSupported;
  const ffmpegCodecInfo = getCodecInfo(input.visualMode === 'gif' ? 'gif' : input.ffmpegCodec);
  const showFFmpegQualityControl = input.visualMode !== 'gif' && input.ffmpegCodec === 'mjpeg';
  const isWebCodecsEncoder = input.encoder === 'webcodecs' || input.encoder === 'htmlvideo';
  const isXmlMode = input.specialContainer === 'xml';
  const isImageMode = !isXmlMode && input.videoEnabled && input.visualMode === 'image';
  const isImageSequenceMode = isImageMode && input.imageExportMode === 'sequence';
  const imageSequenceFolderSupported = isImageSequenceMode && isImageSequenceFolderExportSupported();
  const imageSequenceOutputLabel = imageSequenceFolderSupported ? 'Folder' : 'ZIP';
  const imageSequenceBaseName = getImageSequenceFolderName(input.filename || 'export', input.imageFormat);
  const imageSequenceOutputName = imageSequenceFolderSupported ? `${imageSequenceBaseName}/` : `${imageSequenceBaseName}.zip`;
  const isGifMode = !isXmlMode && input.videoEnabled && input.visualMode === 'gif';
  const isVideoMode = !isXmlMode && input.videoEnabled && (input.visualMode === 'video' || isGifMode);
  const isAudioOnlyMode = !isXmlMode && !input.videoEnabled;
  const currentContainerId = isXmlMode ? 'fcpxml' : isGifMode ? 'gif' : (isWebCodecsEncoder ? input.containerFormat : input.ffmpegContainer);
  const currentContainerLabel = isXmlMode
    ? 'FCPXML'
    : isGifMode
      ? 'Animated GIF'
      : isWebCodecsEncoder
        ? FrameExporter.getContainerFormats().find(({ id }) => id === input.containerFormat)?.label ?? input.containerFormat.toUpperCase()
        : CONTAINER_FORMATS.find(({ id }) => id === input.ffmpegContainer)?.name ?? input.ffmpegContainer.toUpperCase();
  const currentCodecLabel = isGifMode
    ? (input.encoder === 'ffmpeg' ? 'FFmpeg GIF' : 'Browser GIF')
    : isWebCodecsEncoder
      ? FrameExporter.getVideoCodecs(input.containerFormat).find(({ id }) => id === input.videoCodec)?.label ?? input.videoCodec.toUpperCase()
      : ffmpegCodecInfo?.name ?? input.ffmpegCodec.toUpperCase();
  const methodMeta = getMethodMeta(isGifMode, input.encoder, input.isFFmpegMultiThreaded);
  const ffmpegAudioCodecLabel = getFfmpegAudioCodecLabel(isGifMode, input.ffmpegContainer);
  const effectiveIncludeAudio = (isVideoMode || isXmlMode) && input.includeAudio && !isGifMode;
  const selectedImageFormat = IMAGE_FORMATS.find(({ id }) => id === input.imageFormat) ?? IMAGE_FORMATS[0];
  const browserAudioExtension = input.audioCodec === 'opus' ? 'ogg' : 'aac';
  const browserAudioCodecLabel = input.audioCodec?.toUpperCase() ?? 'AAC';
  const audioOnlyExtension = input.audioOnlyFormat === 'wav' ? 'wav' : browserAudioExtension;
  const audioOnlyCodecLabel = input.audioOnlyFormat === 'wav' ? 'WAV PCM' : browserAudioCodecLabel;
  const browserAudioUnavailable = isWebCodecsEncoder && !input.isAudioSupported && !(isAudioOnlyMode && input.audioOnlyFormat === 'wav');
  const currentAudioCodecLabel = isVideoMode && input.encoder === 'ffmpeg'
    ? ffmpegAudioCodecLabel
    : isAudioOnlyMode
      ? audioOnlyCodecLabel
      : browserAudioCodecLabel;
  const outputHeight = input.stackedAlpha && isVideoMode && !isGifMode ? actualHeight * 2 : actualHeight;
  const frameCount = isImageSequenceMode
    ? imageSequenceFrameCount
    : isVideoMode
      ? Math.ceil((input.durationEndTime - input.durationStartTime) * actualFps)
      : 1;
  const displayExtension = isXmlMode
    ? 'fcpxml'
    : isAudioOnlyMode
      ? audioOnlyExtension
      : isImageMode
        ? (isImageSequenceMode ? imageSequenceOutputLabel.toLowerCase() : input.imageFormat)
        : isGifMode
          ? 'gif'
          : currentContainerId;
  const displayOutputName = isImageSequenceMode ? imageSequenceOutputName : `${input.filename || 'export'}.${displayExtension}`;
  const displayContainerLabel = isImageSequenceMode ? imageSequenceOutputLabel : `.${displayExtension}`;
  const estimatedSizeLabel = isXmlMode
    ? 'Metadata only'
    : isImageMode
      ? (isImageSequenceMode ? `${imageSequenceFrameCount} frames ${imageSequenceOutputLabel}` : 'Current frame')
      : (!input.videoEnabled && !input.includeAudio && !isGifMode)
        ? '-'
        : estimateOutputSize(input, actualFps, gifSizeEstimate.bytes);
  const sizeLabelPrefix = isVideoMode && isWebCodecsEncoder && !isGifMode ? 'Target' : 'Size';
  const sizeStatLabel = isVideoMode && isWebCodecsEncoder && !isGifMode ? 'Target Size' : 'Est. Size';
  const webCodecsRateNote = input.rateControl === 'vbr'
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
          : (input.includeAudio ? 'Audio Only' : 'Nothing Selected');
  const exportDisabled =
    input.isExporting ||
    (isImageSequenceMode && input.durationEndTime <= input.durationStartTime) ||
    (!isImageMode && !isXmlMode && input.durationEndTime <= input.durationStartTime) ||
    isAudioOnlyMode && (!input.includeAudio || (input.audioOnlyFormat === 'browser' && !input.isAudioSupported)) ||
    (isVideoMode && input.encoder === 'ffmpeg' && input.isFFmpegLoading);
  const showRangeInVideo = isVideoMode;
  const showRangeInAudio = isAudioOnlyMode && input.includeAudio;
  const gifContainerFormat = CONTAINER_FORMATS.find(({ id }) => id === 'gif');
  const videoContainerFormats = isWebCodecsEncoder && gifContainerFormat
    ? [...FrameExporter.getContainerFormats(), gifContainerFormat]
    : CONTAINER_FORMATS;
  const selectedPreset = input.presets.find((preset) => preset.id === input.selectedPresetId) ?? null;

  return {
    actualWidth,
    actualHeight,
    actualFps,
    imageSequenceFrameCount,
    gifSizeRangeLabel,
    webCodecsAvailable,
    ffmpegAvailable,
    ffmpegCodecInfo,
    showFFmpegQualityControl,
    isWebCodecsEncoder,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    imageSequenceFolderSupported,
    imageSequenceOutputLabel,
    isGifMode,
    isVideoMode,
    isAudioOnlyMode,
    currentContainerId,
    currentContainerLabel,
    currentCodecLabel,
    methodMeta,
    ffmpegAudioCodecLabel,
    effectiveIncludeAudio,
    selectedImageFormat,
    browserAudioExtension, browserAudioCodecLabel, browserAudioUnavailable, audioOnlyExtension,
    currentAudioCodecLabel,
    outputHeight,
    frameCount,
    displayOutputName,
    displayContainerLabel,
    estimatedSizeLabel,
    sizeStatLabel,
    webCodecsRateNote,
    exportModeLabel,
    exportDisabled,
    primaryExportLabel: 'Export',
    usesBrowserProgress: isImageSequenceMode || input.encoder === 'webcodecs' || input.encoder === 'htmlvideo',
    summaryBadges: buildSummaryBadges({
      input,
      isXmlMode,
      isImageMode,
      isImageSequenceMode,
      isVideoMode,
      isGifMode,
      isAudioOnlyMode,
      effectiveIncludeAudio,
      exportModeLabel,
      currentContainerLabel,
      selectedImageFormat,
      actualWidth,
      actualHeight,
      actualFps,
      imageSequenceFrameCount,
      imageSequenceOutputLabel,
      currentAudioCodecLabel,
      methodTitle: methodMeta.title,
      currentCodecLabel,
      outputHeight,
      showFFmpegQualityControl,
      estimatedSizeLabel,
      sizeLabelPrefix,
    }),
    showRangeInVideo,
    showRangeInAudio,
    quickResolutionPresets: RESOLUTION_PRESETS,
    quickFrameRatePresets: [24, 30, 60],
    videoContainerFormats,
    webQualityPresets: [
      { id: 'review', label: 'Review', detail: '8 Mbps', value: 8_000_000 },
      { id: 'standard', label: 'Standard', detail: '15 Mbps', value: 15_000_000 },
      { id: 'high', label: 'High', detail: '25 Mbps', value: 25_000_000 },
      { id: 'master', label: 'Master', detail: '50 Mbps', value: 50_000_000 },
    ] as const,
    audioSampleRatePresets: [
      { value: 48000 as const, label: '48 kHz' },
      { value: 44100 as const, label: '44.1 kHz' },
    ] as const,
    audioBitratePresets: [
      { value: 128000, label: '128 kbps' },
      { value: 192000, label: '192 kbps' },
      { value: 256000, label: '256 kbps' },
      { value: 320000, label: '320 kbps' },
    ] as const,
    selectedPreset,
    selectedPresetName: selectedPreset?.name ?? '',
  };
}

function estimateOutputSize(
  input: ExportSettingsStateInput,
  actualFps: number,
  gifBytes: number,
): string {
  const durationSec = input.durationEndTime - input.durationStartTime;
  if (durationSec <= 0) {
    return '-';
  }
  if (input.visualMode === 'gif') {
    return `~${formatByteSize(gifBytes)}`;
  }

  let estimatedBitrate: number;
  if (!input.videoEnabled) {
    estimatedBitrate = input.audioOnlyFormat === 'wav'
      ? input.audioSampleRate * 2 * 16
      : input.audioBitrate;
  } else if (input.encoder === 'webcodecs' || input.encoder === 'htmlvideo') {
    estimatedBitrate = input.bitrate;
  } else if (input.ffmpegRateControl === 'crf') {
    const pixels = input.useCustomResolution
      ? input.customWidth * input.customHeight
      : input.width * input.height;
    const qualityFactor = Math.pow(2, (51 - input.ffmpegQuality) / 6);
    estimatedBitrate = (pixels * actualFps * qualityFactor) / 10000;
    estimatedBitrate = Math.min(estimatedBitrate, 100_000_000);
  } else {
    estimatedBitrate = input.ffmpegBitrate;
  }

  if (
    input.videoEnabled &&
    input.includeAudio &&
    (input.encoder === 'webcodecs' || input.encoder === 'htmlvideo')
  ) {
    estimatedBitrate += input.audioBitrate;
  }

  const bytes = (estimatedBitrate / 8) * durationSec;
  if (bytes > 1024 * 1024 * 1024) {
    return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function getMethodMeta(
  isGifMode: boolean,
  encoder: EncoderType,
  isFFmpegMultiThreaded: boolean,
) {
  if (isGifMode) {
    return {
      title: encoder === 'ffmpeg' ? 'FFmpeg GIF' : 'Browser GIF',
      badge: encoder === 'ffmpeg' ? 'Palette' : 'Browser',
      description: encoder === 'ffmpeg'
        ? 'Palette and dither controlled animated GIF output.'
        : 'Browser-side animated GIF output without loading FFmpeg.',
    };
  }

  if (encoder === 'webcodecs') {
    return {
      title: 'WebCodecs Fast',
      badge: 'Fast',
      description: 'Best for quick delivery renders directly in the browser.',
    };
  }

  if (encoder === 'htmlvideo') {
    return {
      title: 'HTMLVideo Precise',
      badge: 'Precise',
      description: 'Explicit HTMLVideo seeking for difficult timing cases.',
    };
  }

  return {
    title: 'FFmpeg CPU',
    badge: isFFmpegMultiThreaded ? 'Intermediate' : 'CPU',
    description: 'Professional intermediates and edit-friendly interchange formats.',
  };
}

function getFfmpegAudioCodecLabel(
  isGifMode: boolean,
  ffmpegContainer: FFmpegContainer,
): string {
  if (isGifMode) {
    return 'None';
  }
  if (ffmpegContainer === 'mov') {
    return 'AAC';
  }
  if (ffmpegContainer === 'mkv') {
    return 'FLAC';
  }
  if (ffmpegContainer === 'avi' || ffmpegContainer === 'mxf') {
    return 'PCM';
  }
  return 'AAC';
}
