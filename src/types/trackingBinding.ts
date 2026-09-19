import type { TerrainPlacement } from './terrainTracking';

/** Durable reference from an ordinary clip to a project-owned tracking asset. */
export interface TrackingBinding {
  version: 1;
  assetId: string;
  /** Same-composition video whose displayed PTS drives the binding. */
  targetVideoClipId?: string;
  mode: 'follow' | 'surface';
  /** Normalized point in the reference tracked quad. */
  point: { x: number; y: number };
  /** Composition-normalized offset applied after tracking. */
  offset: { x: number; y: number };
  /** Surface extent in normalized planar units or reconstructed terrain units. */
  placement?: TerrainPlacement;
  /** Source-media PTS used when no same-composition video can supply a displayed frame. */
  sourceStart?: number;
}

export function cloneTrackingBinding(binding: TrackingBinding | undefined): TrackingBinding | undefined {
  return binding ? structuredClone(binding) : undefined;
}
