// Codec configuration and preset helpers

import type {
  VideoCodec,
  ContainerFormat,
  ResolutionPreset,
  FrameRatePreset,
  ContainerFormatOption,
  VideoCodecOption,
} from './types';

// ============ CODEC STRINGS ============

/**
 * Get WebCodecs codec string for VideoEncoder configuration.
 */
export function getCodecString(codec: VideoCodec): string {
  switch (codec) {
    case 'h264':
      return 'avc1.4d0028'; // Main Profile, Level 4.0 (better VLC compatibility)
    case 'h265':
      return 'hvc1.1.6.L93.B0'; // Main Profile, Level 3.1
    case 'vp9':
      return 'vp09.00.10.08'; // Profile 0, Level 1.0, 8-bit
    case 'av1':
      return 'av01.0.04M.08'; // Main Profile, Level 3.0, 8-bit
    default:
      return 'avc1.640028';
  }
}

/**
 * Get mp4-muxer codec identifier.
 */
export function getMp4MuxerCodec(codec: VideoCodec): 'avc' | 'hevc' | 'vp9' | 'av1' {
  switch (codec) {
    case 'h264':
      return 'avc';
    case 'h265':
      return 'hevc';
    case 'vp9':
      return 'vp9';
    case 'av1':
      return 'av1';
    default:
      return 'avc';
  }
}

/**
 * Get WebM muxer video codec identifier.
 */
export function getWebmMuxerCodec(codec: VideoCodec): 'V_VP9' | 'V_AV1' {
  return codec === 'av1' ? 'V_AV1' : 'V_VP9';
}

/**
 * Check if codec is supported in container.
 */
export function isCodecSupportedInContainer(codec: VideoCodec, container: ContainerFormat): boolean {
  if (container === 'webm') {
    // WebM only supports VP9 and AV1
    return codec === 'vp9' || codec === 'av1';
  }
  // MP4 supports all codecs
  return true;
}

/**
 * Get fallback codec for container.
 */
export function getFallbackCodec(container: ContainerFormat): VideoCodec {
  return container === 'webm' ? 'vp9' : 'h264';
}

// ============ PRESETS ============

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: '1080p (1920x1080)', width: 1920, height: 1080 },
  { label: '720p (1280x720)', width: 1280, height: 720 },
  { label: '480p (854x480)', width: 854, height: 480 },
];

export const FRAME_RATE_PRESETS: FrameRatePreset[] = [
  { label: '60 fps', fps: 60 },
  { label: '30 fps', fps: 30 },
  { label: '25 fps (PAL)', fps: 25 },
  { label: '24 fps (Film)', fps: 24 },
];

export const CONTAINER_FORMATS: ContainerFormatOption[] = [
  { id: 'mp4', label: 'MP4', extension: '.mp4' },
  { id: 'webm', label: 'WebM', extension: '.webm' },
];

export function getVideoCodecsForContainer(container: ContainerFormat): VideoCodecOption[] {
  if (container === 'webm') {
    return [
      { id: 'vp9', label: 'VP9', description: 'Good quality, widely supported' },
      { id: 'av1', label: 'AV1', description: 'Best quality, slow encoding' },
    ];
  }
  // MP4 container
  return [
    { id: 'h264', label: 'H.264 (AVC)', description: 'Most compatible, fast encoding' },
    { id: 'h265', label: 'H.265 (HEVC)', description: 'Better compression, limited support' },
    { id: 'vp9', label: 'VP9', description: 'Good quality, open codec' },
    { id: 'av1', label: 'AV1', description: 'Best quality, slow encoding' },
  ];
}

// ============ BITRATE ============

export function getRecommendedBitrate(width: number): number {
  if (width >= 3840) return 35_000_000;
  if (width >= 1920) return 15_000_000;
  if (width >= 1280) return 8_000_000;
  return 5_000_000;
}

export const BITRATE_RANGE = {
  min: 1_000_000,
  max: 100_000_000,
  step: 500_000,
};

export function formatBitrate(bitrate: number): string {
  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  }
  return `${(bitrate / 1_000).toFixed(0)} Kbps`;
}

// ============ CODEC SUPPORT CHECK ============

export async function checkCodecSupport(
  codec: VideoCodec,
  width: number,
  height: number
): Promise<boolean> {
  if (!('VideoEncoder' in window)) return false;

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: getCodecString(codec),
      width,
      height,
      bitrate: 10_000_000,
      framerate: 30,
    });
    return support.supported ?? false;
  } catch {
    return false;
  }
}
