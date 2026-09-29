// Adapts parsed MXF metadata to the IsobmffMediaMetadata shape the import
// pipeline already consumes. Pure metadata: no WASM, no decoder, no store access.

import type { IsobmffMediaMetadata } from '../isobmffMetadata';
import type { MxfUnsupportedReason } from './mxfCodecIdentity';
import { createFileByteSource } from './mxfByteSource';
import { isMxfSource, readMxfMetadata, type MxfMetadata } from './mxfMetadata';

/** Codec id for MXF picture essence the browser path cannot decode (explicit, never silently black). */
export const MXF_UNSUPPORTED_CODEC_PREFIX = 'mxf:unsupported:';

export function isMxfFileName(fileName: string): boolean {
  return fileName.split('.').pop()?.toLowerCase() === 'mxf';
}

/** Extension check first, then a partition-pack sniff for renamed/extension-less files. */
export async function isMxfFile(file: Blob & { name?: string }): Promise<boolean> {
  if (file.name && isMxfFileName(file.name)) return true;
  try {
    return await isMxfSource(createFileByteSource(file));
  } catch {
    return false;
  }
}

export function isMxfCodecId(codecId: string | undefined): boolean {
  return !!codecId && codecId.startsWith('mxf:');
}

export function getMxfUnsupportedReason(codecId: string | undefined): MxfUnsupportedReason | null {
  if (!codecId?.startsWith(MXF_UNSUPPORTED_CODEC_PREFIX)) return null;
  return codecId.slice(MXF_UNSUPPORTED_CODEC_PREFIX.length) as MxfUnsupportedReason;
}

const MXF_CODEC_LABELS: Record<string, string> = {
  'mxf:dnxhd': 'DNxHD/DNxHR',
  'mxf:mpeg2-intra': 'MPEG-2 Intra (IMX)',
  'mxf:mpeg2-lgop': 'MPEG-2 Long GOP',
  'mxf:avc-intra': 'H.264 Intra (XAVC-I/AVC-Intra)',
  'mxf:avc-lgop': 'H.264 Long GOP',
};

export function getMxfCodecLabel(codecId: string): string | undefined {
  const unsupported = getMxfUnsupportedReason(codecId);
  if (unsupported === 'jpeg2000') return 'JPEG 2000 (not supported)';
  if (unsupported) return 'Unknown MXF essence (not supported)';
  return MXF_CODEC_LABELS[codecId];
}

export function mapMxfMetadata(meta: MxfMetadata): IsobmffMediaMetadata {
  const video = meta.video;
  const codecId = video
    ? video.codecId ?? `${MXF_UNSUPPORTED_CODEC_PREFIX}${video.unsupportedReason ?? 'unknown-essence'}`
    : undefined;
  const pixelAspect = video?.aspectRatio && video.width > 0 && video.height > 0
    ? reducePixelAspect(video.aspectRatio.num * video.height, video.aspectRatio.den * video.width)
    : undefined;
  return {
    duration: meta.durationSeconds > 0 ? meta.durationSeconds : undefined,
    width: video?.width || undefined,
    height: video?.height || undefined,
    fps: video?.fps || undefined,
    videoCodecId: codecId,
    codedWidth: video?.codedWidth || undefined,
    codedHeight: video?.codedHeight || undefined,
    rotation: 0,
    ...(pixelAspect && pixelAspect.numerator !== pixelAspect.denominator ? { pixelAspectRatio: pixelAspect } : {}),
    hasAudio: meta.audio.some((a) => a.channels > 0),
    audioCodecId: meta.audio.length > 0 ? 'pcm' : undefined,
  };
}

function reducePixelAspect(num: number, den: number): { numerator: number; denominator: number } | undefined {
  if (!(num > 0) || !(den > 0)) return undefined;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(num), Math.round(den)) || 1;
  return { numerator: Math.round(num) / g, denominator: Math.round(den) / g };
}

export async function readMxfMediaMetadata(file: Blob): Promise<IsobmffMediaMetadata | null> {
  try {
    return mapMxfMetadata(await readMxfMetadata(createFileByteSource(file)));
  } catch {
    return null;
  }
}
