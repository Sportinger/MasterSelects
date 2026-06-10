import type { Composition } from '../../stores/mediaStore';
import type { ExportAudioFormat } from '../../stores/exportStore';
import type { EncoderType } from './useExportState';

export type ExportSummaryTarget =
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

export type ExportSummaryBadge = {
  label: string;
  target: ExportSummaryTarget;
  warning?: boolean;
};

export interface ExportSummaryStateInput {
  composition: Composition | undefined;
  includeAudio: boolean;
  normalizeAudio: boolean;
  audioOnlyFormat: ExportAudioFormat;
  audioSampleRate: number;
  audioBitrate: number;
  playheadPosition: number;
  imageQuality: number;
  gifColors: number;
  ffmpegQuality: number;
  bitrate: number;
  encoder: EncoderType;
  stackedAlpha: boolean;
  durationStartTime: number;
  durationEndTime: number;
}

export interface ExportSummaryStateArgs {
  input: ExportSummaryStateInput;
  isXmlMode: boolean;
  isImageMode: boolean;
  isImageSequenceMode: boolean;
  isVideoMode: boolean;
  isGifMode: boolean;
  isAudioOnlyMode: boolean;
  effectiveIncludeAudio: boolean;
  exportModeLabel: string;
  currentContainerLabel: string;
  selectedImageFormat: {
    label: string;
    supportsAlpha: boolean;
    lossless: boolean;
  };
  actualWidth: number;
  actualHeight: number;
  actualFps: number;
  imageSequenceFrameCount: number;
  imageSequenceOutputLabel: string;
  currentAudioCodecLabel: string;
  methodTitle: string;
  currentCodecLabel: string;
  outputHeight: number;
  showFFmpegQualityControl: boolean;
  estimatedSizeLabel: string;
  sizeLabelPrefix: string;
}

export function buildSummaryBadges(args: ExportSummaryStateArgs): ExportSummaryBadge[] {
  const { input } = args;
  const audioSummaryBadges = (args.effectiveIncludeAudio || args.isAudioOnlyMode && input.includeAudio)
    ? [
        { label: args.currentAudioCodecLabel, target: 'audio-format' as const },
        { label: `${input.audioSampleRate / 1000} kHz`, target: 'audio-format' as const },
        {
          label: args.isAudioOnlyMode && input.audioOnlyFormat === 'wav'
            ? '16-bit PCM'
            : `${Math.round(input.audioBitrate / 1000)} kbps`,
          target: 'audio-quality' as const,
        },
        { label: input.normalizeAudio ? 'Normalized' : 'Unprocessed', target: 'audio-processing' as const },
      ]
    : [];

  if (args.isXmlMode) {
    return [
      { label: args.exportModeLabel, target: 'basic-container' },
      { label: args.currentContainerLabel, target: 'basic-container' },
      { label: `${input.composition?.width ?? args.actualWidth}x${input.composition?.height ?? args.actualHeight}`, target: 'basic-output' },
      { label: `${input.composition?.frameRate ?? args.actualFps} fps`, target: 'basic-output' },
      { label: input.includeAudio ? 'With audio refs' : 'No audio refs', target: 'audio-section' },
    ];
  }

  if (args.isImageMode) {
    return [
      { label: args.exportModeLabel, target: 'image-section' },
      { label: args.isImageSequenceMode ? `Sequence ${args.imageSequenceOutputLabel}` : 'Single frame', target: 'image-mode' },
      { label: args.selectedImageFormat.label, target: 'basic-container' },
      { label: `${args.actualWidth}x${args.actualHeight}`, target: 'image-resolution' },
      {
        label: args.isImageSequenceMode
          ? `${args.imageSequenceFrameCount} frames`
          : `Frame ${formatExportTime(input.playheadPosition)}`,
        target: args.isImageSequenceMode ? 'image-range' : 'image-section',
      },
      ...(args.isImageSequenceMode ? [{
        label: `${args.actualFps} fps`,
        target: 'image-fps' as const,
      }] : []),
      {
        label: args.selectedImageFormat.lossless ? 'Lossless' : `${Math.round(input.imageQuality * 100)}% quality`,
        target: 'image-quality',
      },
      {
        label: args.selectedImageFormat.supportsAlpha ? 'Alpha kept' : 'Opaque export',
        target: 'image-quality',
        warning: !args.selectedImageFormat.supportsAlpha,
      },
    ];
  }

  return [
    {
      label: args.exportModeLabel,
      target: args.isVideoMode ? 'video-section' : 'audio-section',
    },
    {
      label: args.isVideoMode ? args.methodTitle : `Audio ${args.currentAudioCodecLabel}`,
      target: args.isVideoMode ? 'video-section' : 'audio-format',
    },
    ...(args.isVideoMode ? [
      { label: args.currentContainerLabel, target: 'basic-container' as const },
      { label: args.currentCodecLabel, target: 'video-codec' as const },
      { label: `${args.actualWidth}x${args.outputHeight}`, target: 'video-resolution' as const },
      { label: `${args.actualFps} fps`, target: 'video-fps' as const },
      {
        label: args.isGifMode
          ? `${input.gifColors} colors`
          : input.encoder === 'ffmpeg'
            ? (args.showFFmpegQualityControl ? `MJPEG Q${input.ffmpegQuality}` : args.currentCodecLabel)
            : `${(input.bitrate / 1_000_000).toFixed(1)} Mbps`,
        target: args.isGifMode
          ? 'gif-palette' as const
          : input.encoder === 'ffmpeg' && !args.showFFmpegQualityControl ? 'video-codec' as const : 'video-rate' as const,
      },
    ] : []),
    ...audioSummaryBadges,
    {
      label: `Range ${formatExportTime(input.durationStartTime)} - ${formatExportTime(input.durationEndTime)}`,
      target: args.isVideoMode ? (args.isGifMode ? 'gif-palette' : 'video-alpha') : 'audio-processing',
    },
    {
      label: `Duration ${formatExportTime(input.durationEndTime - input.durationStartTime)}`,
      target: args.isVideoMode ? (args.isGifMode ? 'gif-palette' : 'video-alpha') : 'audio-processing',
    },
    ...(input.stackedAlpha && args.isVideoMode && !args.isGifMode ? [{
      label: 'Stacked alpha',
      target: 'video-alpha' as const,
      warning: true,
    }] : []),
    {
      label: `${args.sizeLabelPrefix} ${args.estimatedSizeLabel}`,
      target: args.isVideoMode
        ? (args.isGifMode ? 'gif-palette' : args.showFFmpegQualityControl ? 'video-rate' : 'video-codec')
        : 'audio-quality',
      warning: true,
    },
  ];
}

function formatExportTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}
