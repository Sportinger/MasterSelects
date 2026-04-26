// Audio detection helpers for various video container formats
// Supports: MP4, MOV, M4V, 3GP (via MediaBunny), WebM, MKV, AVI, etc.

import { Logger } from '../../../services/logger';

const log = Logger.create('AudioDetection');

// Lazy-load mediabunny only when needed (tree-shaking friendly)
let _mediabunny: typeof import('mediabunny') | null = null;
async function getMediaBunny() {
  if (!_mediabunny) {
    _mediabunny = await import('mediabunny');
  }
  return _mediabunny;
}

// MP4-based containers that MediaBunny can parse
const MP4_CONTAINERS = ['mp4', 'm4v', 'mov', '3gp', 'mp4v'];

// WebM/Matroska containers
const WEBM_CONTAINERS = ['webm', 'mkv'];

type DisposableMediaInput = {
  dispose(): void;
};

interface VideoWithAudioMetadata extends HTMLVideoElement {
  audioTracks?: { length: number };
  webkitAudioDecodedByteCount?: number;
}

/**
 * Detect if a video file has audio tracks.
 * Uses multiple detection methods depending on container format.
 */
export async function detectVideoAudio(file: File): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  log.debug('Detecting audio', { file: file.name, ext });

  // Method 1: MediaBunny for MP4-based containers (most reliable for positive detection)
  if (MP4_CONTAINERS.includes(ext)) {
    const result = await detectAudioMP4Box(file);
    if (result === true) {
      log.debug('MediaBunny detection result', { file: file.name, hasAudio: true });
      return true;
    }
    // Don't trust false from container parsing - camera MOV files may use
    // PCM audio codecs that aren't always classified as audioTracks.
    // Fall through to VideoElement detection.
    log.debug('MediaBunny returned non-positive, trying fallback', { file: file.name, result });
  }

  // Method 2: HTMLVideoElement for WebM and other formats
  const videoElementResult = await detectAudioVideoElement(file);
  if (videoElementResult !== null) {
    log.debug('VideoElement detection result', { file: file.name, hasAudio: videoElementResult });
    return videoElementResult;
  }

  // Method 3: MediaSource probe for WebM/MKV
  if (WEBM_CONTAINERS.includes(ext)) {
    const webmResult = await detectAudioWebM(file);
    if (webmResult !== null) {
      log.debug('WebM detection result', { file: file.name, hasAudio: webmResult });
      return webmResult;
    }
  }

  // Fallback: Assume audio exists (better than wrongly removing it)
  log.debug('Using fallback - assuming audio exists', { file: file.name });
  return true;
}

/**
 * Detect audio using MediaBunny (for MP4/MOV/M4V/3GP containers).
 * Returns null if detection fails.
 */
async function detectAudioMP4Box(file: File): Promise<boolean | null> {
  const cleanup: { input: DisposableMediaInput | null } = { input: null };
  try {
    const mb = await getMediaBunny();

    const result = await Promise.race([
      (async () => {
        const input = new mb.Input({
          formats: [mb.MP4, mb.QTFF],
          source: new mb.BlobSource(file),
        });
        cleanup.input = input;

        const audioTracks = await input.getAudioTracks();
        const videoTracks = await input.getVideoTracks();
        const hasAudio = audioTracks.length > 0;

        log.debug('MediaBunny parsed', {
          file: file.name,
          audioTracks: audioTracks.length,
          videoTracks: videoTracks.length,
        });

        return hasAudio;
      })(),
      new Promise<null>((resolve) => setTimeout(() => {
        log.debug('MediaBunny timeout', { file: file.name });
        resolve(null);
      }, 5000)),
    ]);

    return result;
  } catch (error) {
    log.debug('MediaBunny error', { file: file.name, error });
    return null;
  } finally {
    try { cleanup.input?.dispose(); } catch { /* ignore */ }
  }
}

/**
 * Detect audio using HTMLVideoElement properties.
 * Works for formats the browser can play natively.
 * Returns null if detection is inconclusive.
 */
async function detectAudioVideoElement(file: File): Promise<boolean | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.preload = 'metadata';

    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      video.src = '';
    };

    video.onloadedmetadata = () => {
      // Method A: audioTracks API (Chrome/Safari)
      const videoWithAudioMetadata = video as VideoWithAudioMetadata;
      if ('audioTracks' in videoWithAudioMetadata) {
        const audioTracks = videoWithAudioMetadata.audioTracks;
        if (audioTracks && typeof audioTracks.length === 'number') {
          cleanup();
          resolve(audioTracks.length > 0);
          return;
        }
      }

      // Method B: webkitAudioDecodedByteCount (Chrome)
      // Need to play briefly to get this value
      video.currentTime = 0.1;
      video.play().then(() => {
        setTimeout(() => {
          video.pause();
          const audioBytes = videoWithAudioMetadata.webkitAudioDecodedByteCount;
          if (typeof audioBytes === 'number') {
            cleanup();
            resolve(audioBytes > 0);
            return;
          }
          cleanup();
          resolve(null); // Inconclusive
        }, 300); // 300ms for large camera MOV files that need more decode time
      }).catch(() => {
        cleanup();
        resolve(null);
      });
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.load();
  });
}

/**
 * Detect audio in WebM/MKV by parsing EBML header.
 * WebM uses EBML (Extensible Binary Meta Language).
 */
async function detectAudioWebM(file: File): Promise<boolean | null> {
  try {
    // Read first 1MB to find track info
    const maxBytes = 1024 * 1024;
    const blob = file.slice(0, Math.min(file.size, maxBytes));
    const buffer = await blob.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Simple WebM/MKV parsing - look for audio track type marker
    // Track type 2 = audio in EBML
    // This is a simplified check - look for TrackType element (0x83) with value 2

    // EBML audio track markers we're looking for
    const audioMarkers = [
      [0x83, 0x02], // TrackType = 2 (audio)
      [0x86, 0x41, 0x5f, 0x4f, 0x50, 0x55, 0x53], // CodecID "A_OPUS"
      [0x86, 0x41, 0x5f, 0x56, 0x4f, 0x52, 0x42, 0x49, 0x53], // CodecID "A_VORBIS"
      [0x86, 0x41, 0x5f, 0x41, 0x41, 0x43], // CodecID "A_AAC"
    ];

    for (const marker of audioMarkers) {
      if (findSequence(data, marker)) {
        return true;
      }
    }

    // Didn't find audio markers, but this doesn't mean no audio
    // Return null to try other methods
    return null;
  } catch (e) {
    log.debug('WebM parsing failed', e);
    return null;
  }
}

/**
 * Find a byte sequence in a buffer.
 */
function findSequence(data: Uint8Array, sequence: number[]): boolean {
  outer: for (let i = 0; i <= data.length - sequence.length; i++) {
    for (let j = 0; j < sequence.length; j++) {
      if (data[i + j] !== sequence[j]) continue outer;
    }
    return true;
  }
  return false;
}
