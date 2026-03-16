// Media info extraction helpers

import { CONTAINER_MAP, MEDIA_INFO_TIMEOUT } from '../constants';
import { Logger } from '../../../services/logger';

const log = Logger.create('MediaInfo');

// Lazy-load mediabunny only when needed (tree-shaking friendly)
let _mediabunny: typeof import('mediabunny') | null = null;
async function getMediaBunny() {
  if (!_mediabunny) {
    _mediabunny = await import('mediabunny');
  }
  return _mediabunny;
}

export interface MediaInfo {
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
function parseCodecName(codec: string): string {
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
  // ProRes
  if (codec.startsWith('apch')) return 'ProRes 422 HQ';
  if (codec.startsWith('apcn')) return 'ProRes 422';
  if (codec.startsWith('apcs')) return 'ProRes 422 LT';
  if (codec.startsWith('apco')) return 'ProRes 422 Proxy';
  if (codec.startsWith('ap4h')) return 'ProRes 4444';
  if (codec.startsWith('ap4x')) return 'ProRes 4444 XQ';
  // DNxHD/DNxHR
  if (codec.startsWith('AVdn')) return 'DNxHD';
  // Audio codecs
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec === 'ac-3' || codec.startsWith('ac-3')) return 'AC-3';
  if (codec === 'ec-3' || codec.startsWith('ec-3')) return 'E-AC-3';
  if (codec === 'Opus' || codec.startsWith('Opus')) return 'Opus';

  return codec;
}

/**
 * Extract detailed media info using MediaBunny (for MP4/MOV/M4V files).
 */
async function getMP4Info(file: File): Promise<Partial<MediaInfo>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanup: { input: any } = { input: null };
  try {
    const mb = await getMediaBunny();

    const result = await Promise.race([
      (async () => {
        const input = new mb.Input({
          formats: [mb.MP4, mb.QTFF],
          source: new mb.BlobSource(file),
        });
        cleanup.input = input;

        const videoTracks = await input.getVideoTracks();
        const audioTracks = await input.getAudioTracks();
        const videoTrack = videoTracks[0] ?? null;
        const audioTrack = audioTracks[0] ?? null;

        // Get codec parameter strings (e.g. 'avc1.64001f', 'mp4a.40.2')
        const videoCodecStr = videoTrack ? await videoTrack.getCodecParameterString() : null;
        const audioCodecStr = audioTrack ? await audioTrack.getCodecParameterString() : null;

        // Compute duration and bitrate
        const duration = await input.computeDuration();
        const bitrate = file.size > 0 && duration > 0
          ? Math.round((file.size * 8) / duration)
          : undefined;

        // Compute FPS from packet stats (only scan first ~200 packets for speed)
        let fps: number | undefined;
        if (videoTrack) {
          try {
            const stats = await videoTrack.computePacketStats(200);
            if (stats.averagePacketRate > 0) {
              fps = Math.round(stats.averagePacketRate * 100) / 100;
            }
          } catch {
            // FPS computation can fail for very short clips
          }
        }

        return {
          codec: videoCodecStr ? parseCodecName(videoCodecStr) : undefined,
          audioCodec: audioCodecStr ? parseCodecName(audioCodecStr) : undefined,
          hasAudio: audioTracks.length > 0,
          bitrate,
          fps,
        } as Partial<MediaInfo>;
      })(),
      new Promise<Partial<MediaInfo>>((resolve) => setTimeout(() => {
        log.debug('MediaBunny timeout', { file: file.name });
        resolve({});
      }, 5000)),
    ]);

    return result;
  } catch (error) {
    log.debug('MediaBunny error', { file: file.name, error });
    return {};
  } finally {
    try { cleanup.input?.dispose(); } catch { /* ignore */ }
  }
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
  const ext = file.name.split('.').pop()?.toLowerCase();

  // For MP4/MOV/M4V, use MediaBunny for accurate codec detection
  const useMP4Box = type === 'video' && ['mp4', 'mov', 'm4v', 'mp4v', '3gp'].includes(ext || '');

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
    } else if (type === 'video') {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = async () => {
        const duration = video.duration;
        const basicInfo: MediaInfo = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration,
          fps: parseFpsFromFilename(file.name),
          container,
          fileSize,
          bitrate: fileSize > 0 && duration > 0 ? Math.round((fileSize * 8) / duration) : undefined,
        };

        // Get detailed info from MediaBunny
        if (useMP4Box) {
          try {
            const mp4Info = await getMP4Info(file);
            Object.assign(basicInfo, {
              codec: mp4Info.codec || getCodecFromExtension(file.name),
              audioCodec: mp4Info.audioCodec,
              hasAudio: mp4Info.hasAudio,
              fps: mp4Info.fps || basicInfo.fps,
            });
          } catch (e) {
            log.debug('MediaBunny failed, using fallback', { file: file.name });
            basicInfo.codec = getCodecFromExtension(file.name);
          }
        } else {
          basicInfo.codec = getCodecFromExtension(file.name);
          // For non-MP4, check audio using Web Audio API
          basicInfo.hasAudio = await checkHasAudioQuick(file);
        }

        resolve(basicInfo);
        cleanup(url);
      };
      video.onerror = () => {
        resolve({ container, fileSize, codec: getCodecFromExtension(file.name) });
        cleanup(url);
      };
      video.load();
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
