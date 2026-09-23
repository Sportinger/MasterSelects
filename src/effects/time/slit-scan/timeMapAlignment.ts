import type { MediaFile } from '../../../stores/mediaStore/types';
import { readDepthMapMetadata } from '../../../services/depthEstimation/depthMapMetadata';
import { temporalSourceTime, type TemporalClipSource } from '../temporalClipSource';

/** Shared clock mapping; both preview and export validate the same baked source coverage. */
export function alignedTimeMapTime(params: Record<string, unknown>, outputTime: number, map: Pick<MediaFile, 'depthMap'>,
  source?: TemporalClipSource, sourceMedia?: Pick<MediaFile, 'id' | 'fileHash'>): { time: number; sourceTime?: number } {
  if (params.mapAlignment !== 'source') return { time: outputTime - Number(params.mapStart ?? 0) };
  const metadata = readDepthMapMetadata(map.depthMap);
  if (!metadata) throw new Error('This time map has no valid depth source metadata. Use Timeline alignment or bake a depth map.');
  if (!source || !sourceMedia || metadata.sourceMediaId !== source.mediaId || sourceMedia.id !== source.mediaId) {
    throw new Error('The depth map belongs to a different source video. Bake depth for this clip or use Timeline alignment.');
  }
  if (metadata.sourceFingerprint !== sourceMedia.fileHash) throw new Error('The depth source has changed. Bake a new depth map.');
  const sourceTime = temporalSourceTime(source, source.localTime);
  if (sourceTime < metadata.sourceStart - 1e-6 || sourceTime > metadata.sourceEnd + 1e-6) {
    throw new Error(`Depth map covers source ${metadata.sourceStart.toFixed(2)}–${metadata.sourceEnd.toFixed(2)} s; source ${sourceTime.toFixed(2)} s is outside the bake. Bake the missing range.`);
  }
  return { time: Math.max(0, sourceTime - metadata.sourceStart), sourceTime };
}
