// Fast MP4/MOV metadata extraction using MediaBunny
// MediaBunny's BlobSource supports random-access reading via Blob.slice(),
// so it can seek to find the moov atom wherever it is (start or end of file).
// This handles camera MOV files with moov at end without manual parallel reads.

import { Logger } from '../../../services/logger';

const log = Logger.create('MP4Metadata');

// Lazy-load mediabunny only when needed (tree-shaking friendly)
let _mediabunny: typeof import('mediabunny') | null = null;
async function getMediaBunny() {
  if (!_mediabunny) {
    _mediabunny = await import('mediabunny');
  }
  return _mediabunny;
}

// MP4-based containers
const MP4_EXTENSIONS = ['mp4', 'm4v', 'mov', '3gp', 'mp4v', 'mxf'];

export interface MP4Metadata {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  codec?: string;
}

/**
 * Extract metadata from MP4/MOV container using MediaBunny.
 * MediaBunny's BlobSource handles random-access reading from Blob,
 * so it can locate the moov atom whether it's at the start or end of the file.
 * This replaces the old MP4Box parallel start+end reading strategy.
 *
 * Returns null if file is not MP4/MOV or parsing fails.
 */
export async function getMP4MetadataFast(file: File, timeoutMs = 5000): Promise<MP4Metadata | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!MP4_EXTENSIONS.includes(ext)) return null;

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

        const duration = await input.computeDuration();
        if (!duration || !isFinite(duration) || duration <= 0) {
          log.debug('MediaBunny: no valid duration', { file: file.name });
          return null;
        }

        const videoTracks = await input.getVideoTracks();
        const audioTracks = await input.getAudioTracks();
        const videoTrack = videoTracks[0] ?? null;

        const metadata: MP4Metadata = {
          duration,
          hasAudio: audioTracks.length > 0,
        };

        if (videoTrack) {
          // Extract dimensions (display dimensions account for rotation + pixel aspect ratio)
          metadata.width = videoTrack.displayWidth;
          metadata.height = videoTrack.displayHeight;

          // Extract FPS from packet stats (scan first ~200 packets for speed)
          try {
            const stats = await videoTrack.computePacketStats(200);
            if (stats.averagePacketRate > 0) {
              metadata.fps = Math.round(stats.averagePacketRate);
            }
          } catch {
            // FPS computation can fail for very short clips
          }

          // Extract codec parameter string (e.g. 'avc1.64001f')
          try {
            const codecStr = await videoTrack.getCodecParameterString();
            if (codecStr) {
              metadata.codec = codecStr;
            }
          } catch {
            // Codec detection can fail for exotic codecs
          }
        }

        log.debug('MediaBunny metadata extracted', {
          file: file.name,
          duration: metadata.duration.toFixed(2),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          hasAudio: metadata.hasAudio,
        });

        return metadata;
      })(),
      new Promise<null>((resolve) => setTimeout(() => {
        log.debug('MediaBunny metadata timeout', { file: file.name });
        resolve(null);
      }, timeoutMs)),
    ]);

    return result;
  } catch (err) {
    log.debug('MediaBunny metadata extraction failed', err);
    return null;
  } finally {
    try { cleanup.input?.dispose(); } catch { /* ignore */ }
  }
}

/**
 * Estimate video duration from file size (very rough fallback).
 * Uses typical bitrates for common camera codecs.
 * Better than showing 5 seconds for a multi-minute video.
 */
export function estimateDurationFromFileSize(file: File): number {
  const sizeMB = file.size / (1024 * 1024);
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  // Camera MOV files are typically 100-200 Mbps
  // Conservative estimate: assume ~150 Mbps for MOV, ~50 Mbps for MP4
  let bitrateMbps: number;
  if (ext === 'mov' || ext === 'mxf') {
    bitrateMbps = 150; // ProRes/camera H.264 tend to be high bitrate
  } else if (ext === 'mp4' || ext === 'm4v') {
    bitrateMbps = 50; // Compressed H.264/H.265
  } else {
    bitrateMbps = 80; // General estimate
  }

  const durationSeconds = (sizeMB * 8) / bitrateMbps;
  // Clamp to reasonable range
  return Math.max(1, Math.min(durationSeconds, 7200)); // 1s to 2h
}
