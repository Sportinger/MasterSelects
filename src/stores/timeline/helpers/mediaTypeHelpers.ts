// Media type detection helpers - shared across clipSlice and other components
// Eliminates duplication of file type detection logic

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'flv'] as const;
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] as const;

export type MediaType = 'video' | 'audio' | 'image' | 'unknown';

/**
 * Detect the media type of a file using MIME type with fallback to extension.
 */
export function detectMediaType(file: File): MediaType {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext as typeof VIDEO_EXTENSIONS[number])) {
    return 'video';
  }
  if (file.type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext as typeof AUDIO_EXTENSIONS[number])) {
    return 'audio';
  }
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext as typeof IMAGE_EXTENSIONS[number])) {
    return 'image';
  }
  return 'unknown';
}

/**
 * Check if a file or filename is an audio file.
 */
export function isAudioFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.includes(ext as typeof AUDIO_EXTENSIONS[number]);
}

/**
 * Check if a file or filename is a video file.
 */
export function isVideoFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(ext as typeof VIDEO_EXTENSIONS[number]);
}

/**
 * Check if a file or filename is an image file.
 */
export function isImageFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.includes(ext as typeof IMAGE_EXTENSIONS[number]);
}

/**
 * Check if a file is a professional codec that may need Native Helper.
 * ProRes typically in .mov, DNxHD in .mxf or .mov
 */
export function isProfessionalCodecFile(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'mov' || ext === 'mxf';
}

/**
 * Get file extension from a file or filename.
 */
export function getFileExtension(file: File | string): string {
  const name = typeof file === 'string' ? file : file.name;
  return name.split('.').pop()?.toLowerCase() || '';
}
