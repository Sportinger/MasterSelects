// src/engine/ffmpeg/index.ts
// Public exports for FFmpeg WASM integration

// Main bridge class
export { FFmpegBridge, getFFmpegBridge } from './FFmpegBridge';

// Codec definitions and presets
export {
  FFMPEG_CODECS,
  PRORES_PROFILES,
  DNXHR_PROFILES,
  HAP_FORMATS,
  CONTAINER_FORMATS,
  PLATFORM_PRESETS,
  // Helper functions
  getCodecInfo,
  getCodecsForContainer,
  getContainersForCodec,
  getCodecsByCategory,
  codecSupportsAlpha,
  codecSupports10bit,
  getCategoryLabel,
} from './codecs';

// Types
export type {
  // Video codec types
  FFmpegVideoCodec,
  FFmpegAudioCodec,
  FFmpegContainer,
  FFmpegImageFormat,
  // Profile types
  ProResProfile,
  HapFormat,
  DnxhrProfile,
  // Settings
  FFmpegExportSettings,
  ImageSequenceSettings,
  // Progress & logging
  FFmpegProgress,
  FFmpegLogEntry,
  // Metadata
  CodecInfo,
  PlatformPreset,
  // Pixel format
  PixelFormat,
  ColorSpace,
} from './types';
