// File type detection utilities for timeline drag & drop

import { DURATION_CHECK_TIMEOUT } from '../constants';

const VIDEO_EXTENSIONS = [
  'mov', 'mp4', 'm4v', 'mxf', 'avi', 'mkv', 'webm',  // Common
  'ts', 'mts', 'm2ts',                               // Transport streams
  'wmv', 'asf', 'flv', 'f4v',                        // Windows/Flash
  '3gp', '3g2', 'ogv', 'vob', 'mpg', 'mpeg',         // Other
];

const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma', 'aiff', 'alac', 'opus',
];

const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif',
];

/**
 * Check if file is a video by MIME type or extension
 */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Check if file is an audio file by MIME type or extension
 */
export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Check if file is any media type (video/audio/image)
 */
export function isMediaFile(file: File): boolean {
  if (
    file.type.startsWith('video/') ||
    file.type.startsWith('audio/') ||
    file.type.startsWith('image/')
  ) {
    return true;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return (
    VIDEO_EXTENSIONS.includes(ext) ||
    AUDIO_EXTENSIONS.includes(ext) ||
    IMAGE_EXTENSIONS.includes(ext)
  );
}

/**
 * Video metadata result including duration and audio presence
 */
export interface VideoMetadata {
  duration: number | null;
  hasAudio: boolean;
}

/**
 * Quick metadata check for dragged video files
 * Returns duration and whether the video has audio tracks
 */
export async function getVideoMetadataQuick(
  file: File,
  timeoutMs = DURATION_CHECK_TIMEOUT
): Promise<VideoMetadata | null> {
  if (!isVideoFile(file)) return null;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);
      const dur = video.duration;

      // Check for audio tracks - use AudioTracks API if available
      // Falls back to assuming audio exists for broader compatibility
      let hasAudio = true; // Default to true for safety

      // Modern browsers with AudioTracks API
      if ('audioTracks' in video) {
        const audioTracks = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
        hasAudio = (audioTracks?.length ?? 0) > 0;
      }

      cleanup();
      resolve({
        duration: isFinite(dur) ? dur : null,
        hasAudio,
      });
    };

    video.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(null);
    };

    video.src = URL.createObjectURL(file);
  });
}

/**
 * Quick duration check for dragged video files
 * Returns null if not a video or duration cannot be determined
 */
export async function getVideoDurationQuick(
  file: File,
  timeoutMs = DURATION_CHECK_TIMEOUT
): Promise<number | null> {
  const metadata = await getVideoMetadataQuick(file, timeoutMs);
  return metadata?.duration ?? null;
}
