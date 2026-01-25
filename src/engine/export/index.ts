// Export module - re-exports all public types and classes

export type {
  VideoCodec,
  ContainerFormat,
  ExportMode,
  ExportSettings,
  FullExportSettings,
  ExportProgress,
  ResolutionPreset,
  FrameRatePreset,
  ContainerFormatOption,
  VideoCodecOption,
} from './types';

export { VideoEncoderWrapper } from './VideoEncoderWrapper';
export { FrameExporter, downloadBlob } from './FrameExporter';

// Codec helpers for UI
export {
  RESOLUTION_PRESETS,
  FRAME_RATE_PRESETS,
  CONTAINER_FORMATS,
  getVideoCodecsForContainer,
  getRecommendedBitrate,
  BITRATE_RANGE,
  formatBitrate,
  checkCodecSupport,
} from './codecHelpers';
