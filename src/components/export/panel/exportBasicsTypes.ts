import type { ContainerFormat, VideoCodec } from '../../../engine/export';
import type {
  DnxhrProfile,
  FFmpegContainer,
  FFmpegVideoCodec,
  ProResProfile,
} from '../../../engine/ffmpeg';
import type {
  GifDither,
  GifLoopMode,
  GifPaletteMode,
} from '../../../engine/gif/gifOptions';
import type {
  ExportAudioFormat,
  ExportImageFormat,
  ExportImageMode,
  ExportSpecialContainer,
  ExportVisualMode,
} from '../../../stores/exportStore';
import type { EncoderType } from '../useExportState';

export interface ExportResolutionPreset {
  label: string;
  width: number;
  height: number;
}

export interface ExportContainerOption {
  id: string;
}

export interface ExportImageFormatOption {
  id: ExportImageFormat;
  label: string;
  mimeType: string;
  supportsAlpha: boolean;
  lossless: boolean;
}

export interface ExportValuePreset<T extends number = number> {
  value: T;
  label: string;
}

export interface ExportWebQualityPreset {
  id: string;
  label: string;
  detail: string;
  value: number;
}

export interface ExportMethodMeta {
  title: string;
  badge: string;
  description: string;
}

export interface ExportCodecInfo {
  description: string;
  supportsAlpha: boolean;
  supports10bit: boolean;
}

export interface ExportBasicsModeState {
  encoder: EncoderType;
  isWebCodecsEncoder: boolean;
  webCodecsAvailable: boolean;
  ffmpegAvailable: boolean;
  isFFmpegLoading: boolean;
  isFFmpegReady: boolean;
  ffmpegLoadError: string | null;
  isXmlMode: boolean;
  isImageMode: boolean;
  isImageSequenceMode: boolean;
  imageSequenceFolderSupported: boolean;
  imageSequenceOutputLabel: string;
  isGifMode: boolean;
  isVideoMode: boolean;
  isAudioOnlyMode: boolean;
  videoEnabled: boolean;
  includeAudio: boolean;
  isAudioSupported: boolean;
  browserAudioUnavailable: boolean;
  showRangeInVideo: boolean;
  showRangeInAudio: boolean;
  showFFmpegQualityControl: boolean;
}

export interface ExportBasicsDisplayState {
  displayOutputName: string;
  displayContainerLabel: string;
  currentContainerId: string;
  currentCodecLabel: string;
  currentAudioCodecLabel: string;
  browserAudioExtension: string;
  browserAudioCodecLabel: string;
  methodMeta: ExportMethodMeta;
  ffmpegCodecInfo: ExportCodecInfo | null;
  estimatedSizeLabel: string;
  sizeStatLabel: string;
  webCodecsRateNote: string;
  gifSizeRangeLabel: string;
}

export interface ExportBasicsVideoState {
  width: number;
  height: number;
  customWidth: number;
  customHeight: number;
  useCustomResolution: boolean;
  actualWidth: number;
  actualHeight: number;
  outputHeight: number;
  fps: number;
  customFps: number;
  useCustomFps: boolean;
  actualFps: number;
  frameCount: number;
  bitrate: number;
  rateControl: 'vbr' | 'cbr';
  containerFormat: ContainerFormat;
  videoCodec: VideoCodec;
  codecSupport: Record<VideoCodec, boolean>;
  ffmpegCodec: FFmpegVideoCodec;
  ffmpegContainer: FFmpegContainer;
  proresProfile: ProResProfile;
  dnxhrProfile: DnxhrProfile;
  ffmpegQuality: number;
  stackedAlpha: boolean;
}

export interface ExportBasicsGifState {
  gifColors: number;
  gifDither: GifDither;
  gifLoop: GifLoopMode;
  gifPaletteMode: GifPaletteMode;
  gifOptimize: boolean;
  gifAlphaThreshold: number;
}

export interface ExportBasicsImageState {
  imageFormat: ExportImageFormat;
  imageExportMode: ExportImageMode;
  imageQuality: number;
  selectedImageFormat: ExportImageFormatOption;
  imageSequenceFrameCount: number;
}

export interface ExportBasicsAudioState {
  includeAudio: boolean;
  audioOnlyFormat: ExportAudioFormat;
  audioSampleRate: number;
  audioBitrate: number;
  normalizeAudio: boolean;
}

export interface ExportBasicsOptionState {
  videoContainerFormats: ReadonlyArray<ExportContainerOption>;
  quickResolutionPresets: ReadonlyArray<ExportResolutionPreset>;
  quickFrameRatePresets: ReadonlyArray<number>;
  webQualityPresets: ReadonlyArray<ExportWebQualityPreset>;
  audioSampleRatePresets: ReadonlyArray<ExportValuePreset<44100 | 48000>>;
  audioBitratePresets: ReadonlyArray<ExportValuePreset>;
}

export interface ExportBasicsTimeState {
  startTime: number;
  endTime: number;
  playheadPosition: number;
  formatTime: (seconds: number) => string;
}

export interface ExportBasicsActions {
  setEncoder: (encoder: EncoderType) => void;
  setFilename: (filename: string) => void;
  setContainerFormat: (format: ContainerFormat) => void;
  handleFFmpegContainerChange: (container: FFmpegContainer) => void;
  setSpecialContainer: (container: ExportSpecialContainer) => void;
  setVideoEnabled: (enabled: boolean) => void;
  setVisualMode: (mode: ExportVisualMode) => void;
  setIncludeAudio: (enabled: boolean) => void;
  setImageFormat: (format: ExportImageFormat) => void;
  setImageExportMode: (mode: ExportImageMode) => void;
  setImageQuality: (quality: number) => void;
  handleQuickResolutionPreset: (value: string) => void;
  handleResolutionChange: (value: string) => void;
  setUseCustomResolution: (enabled: boolean) => void;
  setCustomWidth: (width: number) => void;
  setCustomHeight: (height: number) => void;
  handleQuickFpsPreset: (value: number) => void;
  setUseCustomFps: (enabled: boolean) => void;
  setFps: (fps: number) => void;
  setCustomFps: (fps: number) => void;
  setRateControl: (rateControl: 'vbr' | 'cbr') => void;
  setBitrate: (bitrate: number) => void;
  handleQuickBitratePreset: (value: number) => void;
  setFfmpegQuality: (quality: number) => void;
  handleFFmpegCodecChange: (codec: FFmpegVideoCodec) => void;
  setVideoCodec: (codec: VideoCodec) => void;
  setProresProfile: (profile: ProResProfile) => void;
  setDnxhrProfile: (profile: DnxhrProfile) => void;
  setStackedAlpha: (enabled: boolean) => void;
  setUseInOut: (enabled: boolean) => void;
  setAudioOnlyFormat: (format: ExportAudioFormat) => void;
  setAudioSampleRate: (sampleRate: 44100 | 48000) => void;
  setAudioBitrate: (bitrate: number) => void;
  setNormalizeAudio: (enabled: boolean) => void;
  setGifColors: (colors: number) => void;
  setGifDither: (dither: GifDither) => void;
  setGifLoop: (loop: GifLoopMode) => void;
  setGifPaletteMode: (mode: GifPaletteMode) => void;
  setGifOptimize: (enabled: boolean) => void;
  setGifAlphaThreshold: (threshold: number) => void;
  loadFFmpeg: () => void;
}
