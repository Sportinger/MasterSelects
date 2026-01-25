// MediaStore constants

import type { Composition } from './types';

// Proxy generation settings
export const PROXY_FPS = 30;

// File size thresholds
export const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024; // 500MB
export const HASH_SIZE = 2 * 1024 * 1024; // 2MB for hash calculation

// Timeouts
export const THUMBNAIL_TIMEOUT = 10000; // 10s
export const MEDIA_INFO_TIMEOUT = 15000; // 15s

// Default composition
export const DEFAULT_COMPOSITION: Composition = {
  id: 'comp-1',
  name: 'Comp 1',
  type: 'composition',
  parentId: null,
  createdAt: Date.now(),
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 60,
  backgroundColor: '#000000',
};

// Container format map
export const CONTAINER_MAP: Record<string, string> = {
  mp4: 'MP4',
  m4v: 'MP4',
  mov: 'MOV',
  mkv: 'MKV',
  webm: 'WebM',
  avi: 'AVI',
  wmv: 'WMV',
  flv: 'FLV',
  ogv: 'OGV',
  '3gp': '3GP',
  mp3: 'MP3',
  wav: 'WAV',
  ogg: 'OGG',
  flac: 'FLAC',
  aac: 'AAC',
  m4a: 'M4A',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WebP',
  bmp: 'BMP',
  svg: 'SVG',
};
