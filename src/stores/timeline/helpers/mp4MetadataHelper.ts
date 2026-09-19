// Fast MP4/MOV metadata extraction using MediaBunny
// MediaBunny's BlobSource supports random-access reading via Blob.slice(),
// so it can seek to find the moov atom wherever it is (start or end of file).
// This handles camera MOV files with moov at end without manual parallel reads.

import { Logger } from '../../../services/logger';
import type { MediaVideoTrackMetadata } from '../../../types/mediaMetadata';
import {
  isIsobmffFileName,
  readIsobmffMetadata,
} from '../../../services/mediaMetadata/isobmffMetadata';

const log = Logger.create('MP4Metadata');

export interface MP4Metadata extends MediaVideoTrackMetadata {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  codec?: string;
  audioCodec?: string;
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
  if (!isIsobmffFileName(file.name)) return null;
  const probed = await readIsobmffMetadata(file, timeoutMs);
  if (!probed?.duration) {
    log.debug('MediaBunny: no valid duration', { file: file.name });
    return null;
  }

  const metadata: MP4Metadata = {
    duration: probed.duration,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    hasAudio: probed.hasAudio,
    codec: probed.videoCodecParameter ?? probed.videoCodecId,
    audioCodec: probed.audioCodecParameter ?? probed.audioCodecId,
    videoCodecId: probed.videoCodecId,
    codedWidth: probed.codedWidth,
    codedHeight: probed.codedHeight,
    rotation: probed.rotation,
    pixelAspectRatio: probed.pixelAspectRatio,
    videoColorSpace: probed.videoColorSpace,
    hasHighDynamicRange: probed.hasHighDynamicRange,
    canBeTransparent: probed.canBeTransparent,
  };

  log.debug('MediaBunny metadata extracted', {
    file: file.name,
    duration: metadata.duration.toFixed(2),
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    videoCodecId: metadata.videoCodecId,
    hasAudio: metadata.hasAudio,
  });
  return metadata;
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
