import type {
  MediaVideoColorSpace,
  MediaVideoTrackMetadata,
} from '../../types/mediaMetadata';
import { Logger } from '../logger';

const log = Logger.create('IsobmffMetadata');
const ISOBMFF_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', '3gp', 'mp4v']);
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BLOB_CACHE_BYTES = 8 * 1024 * 1024;

let mediabunnyModule: typeof import('mediabunny') | null = null;

async function getMediabunny(): Promise<typeof import('mediabunny')> {
  mediabunnyModule ??= await import('mediabunny');
  return mediabunnyModule;
}

export interface IsobmffMediaMetadata extends MediaVideoTrackMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodecParameter?: string;
  audioCodecId?: string;
  audioCodecParameter?: string;
  hasAudio: boolean;
  bitrate?: number;
}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function isIsobmffFileName(fileName: string): boolean {
  return ISOBMFF_EXTENSIONS.has(getExtension(fileName));
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

async function optionalValue<T>(read: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

function normalizeColorSpace(value: VideoColorSpaceInit | undefined): MediaVideoColorSpace | undefined {
  if (!value) return undefined;
  const normalized: MediaVideoColorSpace = {};
  if (typeof value.primaries === 'string') normalized.primaries = value.primaries;
  if (typeof value.transfer === 'string') normalized.transfer = value.transfer;
  if (typeof value.matrix === 'string') normalized.matrix = value.matrix;
  if (typeof value.fullRange === 'boolean') normalized.fullRange = value.fullRange;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

async function readMetadata(file: File): Promise<IsobmffMediaMetadata | null> {
  const mb = await getMediabunny();
  const input = new mb.Input({
    formats: [mb.MP4, mb.QTFF],
    source: new mb.BlobSource(file, { maxCacheSize: DEFAULT_BLOB_CACHE_BYTES }),
  });

  try {
    const [durationResult, videoTracks, audioTracks] = await Promise.all([
      optionalValue(() => input.computeDuration()),
      input.getVideoTracks(),
      input.getAudioTracks(),
    ]);
    const videoTrack = videoTracks[0] ?? null;
    const audioTrack = audioTracks[0] ?? null;
    const duration = finitePositive(durationResult);

    if (!videoTrack && !audioTrack && duration === undefined) return null;

    const metadata: IsobmffMediaMetadata = {
      duration,
      hasAudio: audioTracks.length > 0,
      bitrate: duration && file.size > 0
        ? Math.round((file.size * 8) / duration)
        : undefined,
    };

    if (videoTrack) {
      metadata.width = finitePositive(videoTrack.displayWidth);
      metadata.height = finitePositive(videoTrack.displayHeight);
      metadata.codedWidth = finitePositive(videoTrack.codedWidth);
      metadata.codedHeight = finitePositive(videoTrack.codedHeight);
      metadata.rotation = Number.isFinite(videoTrack.rotation) ? videoTrack.rotation : undefined;
      if (typeof videoTrack.internalCodecId === 'string' && videoTrack.internalCodecId.trim()) {
        metadata.videoCodecId = videoTrack.internalCodecId.trim();
      }

      const ratio = videoTrack.pixelAspectRatio;
      if (
        Number.isFinite(ratio?.num) && ratio.num > 0
        && Number.isFinite(ratio?.den) && ratio.den > 0
      ) {
        metadata.pixelAspectRatio = {
          numerator: ratio.num,
          denominator: ratio.den,
        };
      }

      const [codecParameter, packetStats, colorSpace, highDynamicRange, transparent] = await Promise.all([
        optionalValue(() => videoTrack.getCodecParameterString()),
        optionalValue(() => videoTrack.computePacketStats(200)),
        optionalValue(() => videoTrack.getColorSpace()),
        optionalValue(() => videoTrack.hasHighDynamicRange()),
        optionalValue(() => videoTrack.canBeTransparent()),
      ]);

      if (codecParameter) metadata.videoCodecParameter = codecParameter;
      if (packetStats && packetStats.averagePacketRate > 0) {
        metadata.fps = Math.round(packetStats.averagePacketRate * 100) / 100;
      }
      metadata.videoColorSpace = normalizeColorSpace(colorSpace);
      if (typeof highDynamicRange === 'boolean') metadata.hasHighDynamicRange = highDynamicRange;
      if (typeof transparent === 'boolean') metadata.canBeTransparent = transparent;
    }

    if (audioTrack) {
      const codecParameter = await optionalValue(() => audioTrack.getCodecParameterString());
      const internalCodecId = audioTrack.internalCodecId;
      if (typeof internalCodecId === 'string' && internalCodecId.trim()) {
        metadata.audioCodecId = internalCodecId.trim();
      }
      if (codecParameter) metadata.audioCodecParameter = codecParameter;
    }

    return metadata;
  } finally {
    input.dispose();
  }
}

export async function readIsobmffMetadata(
  file: File,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<IsobmffMediaMetadata | null> {
  if (!isIsobmffFileName(file.name)) return null;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readMetadata(file),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => {
          log.debug('Container metadata probe timed out', { file: file.name, timeoutMs });
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    log.debug('Container metadata probe failed', { file: file.name, error });
    return null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
