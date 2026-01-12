// src/engine/ffmpeg/codecs.ts
// Codec definitions, profiles, and platform presets

import type { CodecInfo, FFmpegContainer, PlatformPreset } from './types';

// All available video codecs with metadata
export const FFMPEG_CODECS: CodecInfo[] = [
  // === Professional Intermediate ===
  {
    id: 'prores',
    name: 'Apple ProRes',
    description: 'Industry standard intermediate codec for editing',
    category: 'professional',
    containers: ['mov'],
    supportsAlpha: true,
    supports10bit: true,
    defaultPixelFormat: 'yuv422p10le',
  },
  {
    id: 'dnxhd',
    name: 'Avid DNxHR',
    description: 'Broadcast and Avid workflow codec',
    category: 'professional',
    containers: ['mxf', 'mov'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv422p',
  },

  // === Real-time / VJ ===
  {
    id: 'hap',
    name: 'HAP',
    description: 'GPU-accelerated codec for VJ and media servers',
    category: 'realtime',
    containers: ['mov', 'avi'],
    supportsAlpha: true,
    supports10bit: false,
    defaultPixelFormat: 'rgba',
  },
  {
    id: 'mjpeg',
    name: 'Motion JPEG',
    description: 'Simple frame-by-frame JPEG compression',
    category: 'realtime',
    containers: ['mov', 'avi'],
    supportsAlpha: false,
    supports10bit: false,
    defaultPixelFormat: 'yuv422p',
  },

  // === Lossless ===
  {
    id: 'ffv1',
    name: 'FFV1',
    description: 'Open lossless codec for archival',
    category: 'lossless',
    containers: ['mkv', 'avi'],
    supportsAlpha: true,
    supports10bit: true,
    defaultPixelFormat: 'yuv444p10le',
  },
  {
    id: 'utvideo',
    name: 'Ut Video',
    description: 'Fast lossless codec with alpha support',
    category: 'lossless',
    containers: ['avi', 'mkv'],
    supportsAlpha: true,
    supports10bit: false,
    defaultPixelFormat: 'rgba',
  },

  // === Delivery ===
  {
    id: 'libx264',
    name: 'H.264 (x264)',
    description: 'Universal delivery codec, wide compatibility',
    category: 'delivery',
    containers: ['mp4', 'mkv', 'mov'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
  {
    id: 'libx265',
    name: 'H.265/HEVC (x265)',
    description: 'High efficiency codec with HDR support',
    category: 'delivery',
    containers: ['mp4', 'mkv', 'mov'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
  {
    id: 'libvpx_vp9',
    name: 'VP9',
    description: 'Open web codec with alpha support',
    category: 'delivery',
    containers: ['webm', 'mkv'],
    supportsAlpha: true,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
  {
    id: 'libsvtav1',
    name: 'AV1 (SVT)',
    description: 'Next-generation open codec',
    category: 'delivery',
    containers: ['mp4', 'mkv', 'webm'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
];

// ProRes profile definitions
export const PRORES_PROFILES = [
  { id: 'proxy', name: 'ProRes Proxy', profile: 0, bitrate: 45, description: 'Offline editing' },
  { id: 'lt', name: 'ProRes LT', profile: 1, bitrate: 102, description: 'Light editing' },
  { id: 'standard', name: 'ProRes 422', profile: 2, bitrate: 147, description: 'Standard quality' },
  { id: 'hq', name: 'ProRes 422 HQ', profile: 3, bitrate: 220, description: 'High quality' },
  { id: '4444', name: 'ProRes 4444', profile: 4, bitrate: 330, description: 'With alpha channel' },
  { id: '4444xq', name: 'ProRes 4444 XQ', profile: 5, bitrate: 500, description: 'Maximum quality' },
] as const;

// DNxHR profile definitions
export const DNXHR_PROFILES = [
  { id: 'dnxhr_lb', name: 'DNxHR LB', description: 'Low Bandwidth - offline' },
  { id: 'dnxhr_sq', name: 'DNxHR SQ', description: 'Standard Quality' },
  { id: 'dnxhr_hq', name: 'DNxHR HQ', description: 'High Quality' },
  { id: 'dnxhr_hqx', name: 'DNxHR HQX', description: '10-bit High Quality' },
  { id: 'dnxhr_444', name: 'DNxHR 444', description: '10-bit 4:4:4 RGB' },
] as const;

// HAP format variants
export const HAP_FORMATS = [
  { id: 'hap', name: 'HAP', description: 'Good quality, smallest size' },
  { id: 'hap_alpha', name: 'HAP Alpha', description: 'With alpha channel' },
  { id: 'hap_q', name: 'HAP Q', description: 'Higher quality, larger size' },
] as const;

// Container format info
export const CONTAINER_FORMATS = [
  { id: 'mov', name: 'QuickTime (.mov)', description: 'Apple/Professional' },
  { id: 'mp4', name: 'MP4 (.mp4)', description: 'Universal delivery' },
  { id: 'mkv', name: 'Matroska (.mkv)', description: 'Open format, all codecs' },
  { id: 'webm', name: 'WebM (.webm)', description: 'Web optimized' },
  { id: 'avi', name: 'AVI (.avi)', description: 'Legacy Windows' },
  { id: 'mxf', name: 'MXF (.mxf)', description: 'Broadcast standard' },
] as const;

// Platform and workflow presets
export const PLATFORM_PRESETS: Record<string, PlatformPreset> = {
  // === Social Media ===
  youtube: {
    name: 'YouTube',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    quality: 18,
    audioCodec: 'aac',
    audioBitrate: 256000,
  },
  youtube_hdr: {
    name: 'YouTube HDR',
    codec: 'libx265',
    container: 'mp4',
    pixelFormat: 'yuv420p10le',
    quality: 20,
    audioCodec: 'aac',
    audioBitrate: 256000,
  },
  vimeo: {
    name: 'Vimeo',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    quality: 16,
    audioCodec: 'aac',
    audioBitrate: 320000,
  },
  instagram: {
    name: 'Instagram',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    bitrate: 3500000,
    audioCodec: 'aac',
    audioBitrate: 128000,
  },
  tiktok: {
    name: 'TikTok',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    bitrate: 2500000,
    audioCodec: 'aac',
    audioBitrate: 128000,
  },
  twitter: {
    name: 'Twitter/X',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    bitrate: 5000000,
    audioCodec: 'aac',
    audioBitrate: 128000,
  },

  // === Professional Workflows ===
  premiere: {
    name: 'Adobe Premiere',
    codec: 'prores',
    container: 'mov',
    proresProfile: 'hq',
    audioCodec: 'pcm_s24le',
  },
  davinci: {
    name: 'DaVinci Resolve',
    codec: 'dnxhd',
    container: 'mxf',
    dnxhrProfile: 'dnxhr_hq',
    audioCodec: 'pcm_s24le',
  },
  finalcut: {
    name: 'Final Cut Pro',
    codec: 'prores',
    container: 'mov',
    proresProfile: 'hq',
    audioCodec: 'pcm_s24le',
  },
  avid: {
    name: 'Avid Media Composer',
    codec: 'dnxhd',
    container: 'mxf',
    dnxhrProfile: 'dnxhr_hq',
    audioCodec: 'pcm_s24le',
  },

  // === Special Use Cases ===
  vj: {
    name: 'VJ / Media Server',
    codec: 'hap',
    container: 'mov',
    hapFormat: 'hap_q',
    audioCodec: 'none',
  },
  vj_alpha: {
    name: 'VJ with Alpha',
    codec: 'hap',
    container: 'mov',
    hapFormat: 'hap_alpha',
    audioCodec: 'none',
  },
  archive: {
    name: 'Archive (Lossless)',
    codec: 'ffv1',
    container: 'mkv',
    pixelFormat: 'yuv444p10le',
    audioCodec: 'flac',
  },
  web_transparent: {
    name: 'Web with Alpha',
    codec: 'libvpx_vp9',
    container: 'webm',
    pixelFormat: 'yuva420p',
    quality: 20,
    audioCodec: 'libopus',
    audioBitrate: 128000,
  },
};

// Helper functions

/**
 * Get codec info by ID
 */
export function getCodecInfo(codecId: string): CodecInfo | undefined {
  return FFMPEG_CODECS.find(c => c.id === codecId);
}

/**
 * Get all codecs that support a specific container
 */
export function getCodecsForContainer(container: FFmpegContainer): CodecInfo[] {
  return FFMPEG_CODECS.filter(c => c.containers.includes(container));
}

/**
 * Get all containers that support a specific codec
 */
export function getContainersForCodec(codecId: string): FFmpegContainer[] {
  const codec = getCodecInfo(codecId);
  return codec?.containers || [];
}

/**
 * Get codecs by category
 */
export function getCodecsByCategory(category: CodecInfo['category']): CodecInfo[] {
  return FFMPEG_CODECS.filter(c => c.category === category);
}

/**
 * Check if a codec supports alpha channel
 */
export function codecSupportsAlpha(codecId: string): boolean {
  return getCodecInfo(codecId)?.supportsAlpha ?? false;
}

/**
 * Check if a codec supports 10-bit
 */
export function codecSupports10bit(codecId: string): boolean {
  return getCodecInfo(codecId)?.supports10bit ?? false;
}

/**
 * Get category label for display
 */
export function getCategoryLabel(category: CodecInfo['category']): string {
  const labels: Record<CodecInfo['category'], string> = {
    professional: 'Professional',
    realtime: 'Real-time / VJ',
    lossless: 'Lossless',
    delivery: 'Delivery',
  };
  return labels[category] || category;
}
