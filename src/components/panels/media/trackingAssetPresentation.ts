import type { TrackingAsset } from '../../../types/trackingAsset';

export function getTrackingAssetStateLabel(asset: TrackingAsset): string {
  const cameraCount = asset.track.terrain?.cameras.length ?? 0;
  if (cameraCount > 0) return `${cameraCount} camera frame${cameraCount === 1 ? '' : 's'}`;
  const sampleCount = asset.track.samples.length;
  if (sampleCount === 0) return 'No samples';
  return `${sampleCount} sample${sampleCount === 1 ? '' : 's'}`;
}

export function getTrackingAssetSourceBounds(asset: TrackingAsset): { start: number; end: number } | null {
  const cameras = asset.track.terrain?.cameras ?? [];
  const timedFrames = cameras.length > 0 ? cameras : asset.track.samples;
  if (timedFrames.length === 0) return null;
  return timedFrames.reduce((bounds, frame) => ({
    start: Math.min(bounds.start, frame.time),
    end: Math.max(bounds.end, frame.time + Math.max(0, frame.duration ?? 0)),
  }), { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY });
}

function formatSourceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return minutes > 0
    ? `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`
    : `${remainder.toFixed(2)}s`;
}

export function getTrackingAssetCoverageLabel(asset: TrackingAsset): string | null {
  const bounds = getTrackingAssetSourceBounds(asset);
  return bounds ? `${formatSourceTime(bounds.start)}–${formatSourceTime(bounds.end)} source` : null;
}
