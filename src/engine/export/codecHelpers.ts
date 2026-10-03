// Codec configuration and preset helpers

import type {
  VideoCodec,
  ContainerFormat,
  ResolutionPreset,
  FrameRatePreset,
  ContainerFormatOption,
  VideoCodecOption,
} from './types';
import { av1LevelToken, avcLevelToken, hevcLevelToken, vp9LevelToken, type CodecFrameSize } from './codecLevels';

// ============ CODEC STRINGS ============

/**
 * Get WebCodecs codec string for VideoEncoder configuration. With a frame
 * size the level is raised to the smallest one that fits (e.g. 4K60 HEVC
 * needs Level 5.1); without one the historical default levels are used.
 */
export function getCodecString(codec: string, frame?: CodecFrameSize): string {
  switch (codec) {
    case 'h264':
      // Main Profile, Level 4.0 minimum (better VLC compatibility)
      return `avc1.4d00${frame ? avcLevelToken(frame) : '28'}`;
    case 'h265':
      // Main Profile, Main tier, Level 3.1 minimum
      return `hvc1.1.6.L${frame ? hevcLevelToken(frame) : '93'}.B0`;
    case 'vp9':
      // Profile 0, 8-bit, Level 1.0 minimum
      return `vp09.00.${frame ? vp9LevelToken(frame) : '10'}.08`;
    case 'av1':
      // Main Profile, 8-bit, Level 3.0 minimum
      return `av01.0.${frame ? av1LevelToken(frame) : '04'}M.08`;
    default:
      return 'avc1.640028';
  }
}

/**
 * Get mp4-muxer codec identifier.
 */
export function getMp4MuxerCodec(codec: string): 'avc' | 'hevc' | 'vp9' | 'av1' {
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
export function getWebmMuxerCodec(codec: string): 'V_VP9' | 'V_AV1' {
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
  { label: '4K · 2160p', width: 3840, height: 2160 },
  { label: '2K · 1440p', width: 2560, height: 1440 },
  { label: 'FHD · 1080p', width: 1920, height: 1080 },
  { label: 'HD Ready · 720p', width: 1280, height: 720 },
  { label: '480p', width: 854, height: 480 },
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
  height: number,
  fps = 30,
): Promise<boolean> {
  if (!('VideoEncoder' in window)) return false;

  try {
    // Probe with the level the export itself will use; the bare minimum level
    // (e.g. H.264 4.0) cannot describe large or high-rate frames.
    const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30;
    const support = await VideoEncoder.isConfigSupported({
      codec: getCodecString(codec, { width, height, fps: frameRate }),
      width,
      height,
      bitrate: 10_000_000,
      framerate: frameRate,
    });
    return support.supported ?? false;
  } catch {
    return false;
  }
}
