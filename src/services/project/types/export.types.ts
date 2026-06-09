export type ProjectExportEncoderType = 'webcodecs' | 'htmlvideo' | 'ffmpeg';
export type ProjectExportVisualMode = 'video' | 'image' | 'gif';
export type ProjectExportImageFormat = 'png' | 'jpg' | 'webp' | 'bmp';
export type ProjectExportImageMode = 'frame' | 'sequence';
export type ProjectExportSpecialContainer = 'none' | 'xml';
export type ProjectExportAudioFormat = 'wav' | 'browser';
export type ProjectContainerFormat = 'mp4' | 'webm';
export type ProjectVideoCodec = 'h264' | 'h265' | 'vp9' | 'av1';
export type ProjectFFmpegVideoCodec =
  | 'prores'
  | 'dnxhd'
  | 'ffv1'
  | 'utvideo'
  | 'mjpeg'
  | 'gif';
export type ProjectFFmpegContainer =
  | 'mov'
  | 'mkv'
  | 'avi'
  | 'mxf'
  | 'gif';
export type ProjectProResProfile =
  | 'proxy'
  | 'lt'
  | 'standard'
  | 'hq'
  | '4444'
  | '4444xq';
export type ProjectDnxhrProfile =
  | 'dnxhr_lb'
  | 'dnxhr_sq'
  | 'dnxhr_hq'
  | 'dnxhr_hqx'
  | 'dnxhr_444';
export type ProjectGifDither =
  | 'sierra2_4a'
  | 'floyd_steinberg'
  | 'bayer'
  | 'none';
export type ProjectGifLoopMode = 'forever' | 'once';
export type ProjectGifPaletteMode = 'global' | 'per-frame';

export interface ProjectExportSettings {
  encoder: ProjectExportEncoderType;
  width: number;
  height: number;
  customWidth: number;
  customHeight: number;
  useCustomResolution: boolean;
  fps: number;
  customFps: number;
  useCustomFps: boolean;
  useInOut: boolean;
  filename: string;
  bitrate: number;
  containerFormat: ProjectContainerFormat;
  videoCodec: ProjectVideoCodec;
  rateControl: 'vbr' | 'cbr';
  ffmpegCodec: ProjectFFmpegVideoCodec;
  ffmpegContainer: ProjectFFmpegContainer;
  ffmpegPreset: string;
  proresProfile: ProjectProResProfile;
  dnxhrProfile: ProjectDnxhrProfile;
  ffmpegQuality: number;
  ffmpegBitrate: number;
  ffmpegRateControl: 'crf' | 'cbr' | 'vbr';
  gifColors: number;
  gifDither: ProjectGifDither;
  gifLoop: ProjectGifLoopMode;
  gifPaletteMode: ProjectGifPaletteMode;
  gifOptimize: boolean;
  gifAlphaThreshold: number;
  stackedAlpha: boolean;
  includeAudio: boolean;
  audioOnlyFormat: ProjectExportAudioFormat;
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  normalizeAudio: boolean;
  videoEnabled: boolean;
  visualMode: ProjectExportVisualMode;
  imageFormat: ProjectExportImageFormat;
  imageExportMode: ProjectExportImageMode;
  imageQuality: number;
  specialContainer: ProjectExportSpecialContainer;
}

export interface ProjectExportPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectExportSettings;
}

export interface ProjectExportStoreData {
  settings: ProjectExportSettings;
  presets: ProjectExportPreset[];
  selectedPresetId: string | null;
}
