// Media info extraction helpers

import { CONTAINER_MAP, MEDIA_INFO_TIMEOUT } from '../constants';
import { Logger } from '../../../services/logger';
import type { MediaVideoTrackMetadata } from '../../../types/mediaMetadata';
import {
  isIsobmffFileName,
  readIsobmffMetadata,
  type IsobmffMediaMetadata,
} from '../../../services/mediaMetadata/isobmffMetadata';
import { getProResCodecLabel } from '../../../services/mediaRuntime/prores/turboResCodecIdentity';
import { getHapCodecLabel } from '../../../services/hap/hapCodecIdentity';

const log = Logger.create('MediaInfo');

export interface MediaInfo extends MediaVideoTrackMetadata {
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  codec?: string;
  audioCodec?: string;
  container?: string;
  fileSize?: number;
  bitrate?: number;
  hasAudio?: boolean;
}

/**
 * Get container format from file extension.
 */
export function getContainerFormat(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return CONTAINER_MAP[ext] || ext.toUpperCase();
}

/**
 * Parse FPS from filename (patterns like "25fps", "_30p", etc.).
 */
export function parseFpsFromFilename(fileName: string): number | undefined {
  const patterns = [
    /[_\-\s(](\d{2}(?:\.\d+)?)\s*fps/i,
    /[_\-\s(](\d{2}(?:\.\d+)?)\s*p[_\-\s).]/i,
    /(\d{2}(?:\.\d+)?)fps/i,
  ];

  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match) {
      const fps = parseFloat(match[1]);
      if (fps >= 10 && fps <= 240) return fps;
    }
  }
  return undefined;
}

/**
 * Get codec info from file extension (fallback).
 */
export function getCodecFromExtension(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // Video codecs (fallback guesses)
  if (ext === 'webm') return 'VP9';

  // Audio codecs
  if (ext === 'mp3') return 'MP3';
  if (ext === 'aac' || ext === 'm4a') return 'AAC';
  if (ext === 'wav') return 'PCM';
  if (ext === 'ogg') return 'Vorbis';
  if (ext === 'flac') return 'FLAC';

  return undefined;
}

/**
 * Parse codec string to friendly name.
 */
export function parseCodecName(codec: string): string {
  // H.264/AVC
  if (codec.startsWith('avc1') || codec.startsWith('avc3')) return 'H.264';
  // H.265/HEVC
  if (codec.startsWith('hev1') || codec.startsWith('hvc1')) return 'H.265';
  // VP9
  if (codec.startsWith('vp09') || codec === 'vp9') return 'VP9';
  // VP8
  if (codec.startsWith('vp08') || codec === 'vp8') return 'VP8';
  // AV1
  if (codec.startsWith('av01')) return 'AV1';
  // ProRes, including an explicit label for unsupported ProRes RAW.
  const proResLabel = getProResCodecLabel(codec);
  if (proResLabel) return proResLabel;
  // HAP family (decoded by the browser-local HAP provider).
  const hapLabel = getHapCodecLabel(codec);
  if (hapLabel) return hapLabel;
  // DNxHD/DNxHR
  if (codec.startsWith('AVdn')) return 'DNxHD';
  // Audio codecs
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec === 'ac-3' || codec.startsWith('ac-3')) return 'AC-3';
  if (codec === 'ec-3' || codec.startsWith('ec-3')) return 'E-AC-3';
  if (codec === 'Opus' || codec.startsWith('Opus')) return 'Opus';

  return codec;
}

function mapIsobmffMediaInfo(
  file: File,
  container: string,
  metadata: IsobmffMediaMetadata,
): MediaInfo {
  const videoCodec = metadata.videoCodecParameter ?? metadata.videoCodecId;
  const audioCodec = metadata.audioCodecParameter ?? metadata.audioCodecId;
  return {
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    fps: metadata.fps ?? parseFpsFromFilename(file.name),
    codec: videoCodec ? parseCodecName(videoCodec) : getCodecFromExtension(file.name),
    audioCodec: audioCodec ? parseCodecName(audioCodec) : undefined,
    container,
    fileSize: file.size,
    bitrate: metadata.bitrate,
    hasAudio: metadata.hasAudio,
    videoCodecId: metadata.videoCodecId,
    codedWidth: metadata.codedWidth,
    codedHeight: metadata.codedHeight,
    rotation: metadata.rotation,
    pixelAspectRatio: metadata.pixelAspectRatio,
    videoColorSpace: metadata.videoColorSpace,
    hasHighDynamicRange: metadata.hasHighDynamicRange,
    canBeTransparent: metadata.canBeTransparent,
  };
}

function mergeDefinedMediaInfo(base: MediaInfo, preferred: MediaInfo): MediaInfo {
  const merged = { ...base };
  for (const [key, value] of Object.entries(preferred)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

interface VideoElementMetadataProbe {
  promise: Promise<MediaInfo>;
  cancel(): void;
}

function startVideoElementMetadataProbe(
  file: File,
  container: string,
  fileSize: number,
): VideoElementMetadataProbe {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let finish: (info: MediaInfo) => void = () => undefined;

  const promise = new Promise<MediaInfo>((resolve) => {
    finish = (info) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
      resolve(info);
    };

    timeoutId = setTimeout(() => {
      log.debug('HTML video metadata timeout', { file: file.name });
      finish({ container, fileSize });
    }, MEDIA_INFO_TIMEOUT);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : undefined;
      finish({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        duration,
        fps: parseFpsFromFilename(file.name),
        container,
        fileSize,
        bitrate: duration && fileSize > 0
          ? Math.round((fileSize * 8) / duration)
          : undefined,
      });
    };
    video.onerror = () => finish({ container, fileSize });
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();
  });

  return {
    promise,
    cancel: () => finish({ container, fileSize }),
  };
}

async function getVideoMediaInfo(file: File, container: string): Promise<MediaInfo> {
  const fileSize = file.size;
  const htmlProbe = startVideoElementMetadataProbe(file, container, fileSize);

  if (isIsobmffFileName(file.name)) {
    const containerMetadata = await readIsobmffMetadata(file);
    if (containerMetadata) {
      const containerInfo = mapIsobmffMediaInfo(file, container, containerMetadata);
      const isAuthoritative = Boolean(
        containerInfo.videoCodecId
        || containerInfo.duration
        || (containerInfo.width && containerInfo.height),
      );
      if (isAuthoritative) {
        htmlProbe.cancel();
        return containerInfo;
      }
      const htmlInfo = await htmlProbe.promise;
      return mergeDefinedMediaInfo(htmlInfo, containerInfo);
    }
  }

  const htmlInfo = await htmlProbe.promise;
  htmlInfo.codec ??= getCodecFromExtension(file.name);
  htmlInfo.hasAudio = await checkHasAudioQuick(file);
  return htmlInfo;
}

/**
 * Get media dimensions, duration, and metadata.
 */
export async function getMediaInfo(
  file: File,
  type: 'video' | 'audio' | 'image'
): Promise<MediaInfo> {
  const container = getContainerFormat(file.name);
  const fileSize = file.size;
  if (type === 'video') {
    return getVideoMediaInfo(file, container);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn('Timeout:', file.name);
      resolve({ container, fileSize });
    }, MEDIA_INFO_TIMEOUT);

    const cleanup = (url?: string) => {
      clearTimeout(timeout);
      if (url) URL.revokeObjectURL(url);
    };

    if (type === 'image') {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.src = url;
      img.onload = () => {
        resolve({ width: img.width, height: img.height, container, fileSize });
        cleanup(url);
      };
      img.onerror = () => {
        resolve({ container, fileSize });
        cleanup(url);
      };
    } else if (type === 'audio') {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      audio.src = url;
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        resolve({
          duration,
          codec: getCodecFromExtension(file.name),
          container,
          fileSize,
          bitrate: fileSize > 0 && duration > 0 ? Math.round((fileSize * 8) / duration) : undefined,
          hasAudio: true,
        });
        cleanup(url);
      };
      audio.onerror = () => {
        resolve({ container, fileSize });
        cleanup(url);
      };
    } else {
      cleanup();
      resolve({ container, fileSize });
    }
  });
}

/**
 * Quick check if file has audio using Web Audio API.
 */
async function checkHasAudioQuick(file: File): Promise<boolean> {
  try {
    const audioContext = new AudioContext();
    const maxBytes = 512 * 1024;
    const blob = file.slice(0, Math.min(file.size, maxBytes));
    const arrayBuffer = await blob.arrayBuffer();

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const hasAudio = audioBuffer.numberOfChannels > 0 && audioBuffer.length > 0;
      await audioContext.close();
      return hasAudio;
    } catch {
      await audioContext.close();
      return false;
    }
  } catch {
    return true; // Default to true on error
  }
}
