import type { TerrainCamera, TerrainPlacement, TerrainReconstruction } from './terrainTracking';
import type { PlanarTrack, SurfaceQuad } from './planarTracking';
import type { TrackingBinding } from './trackingBinding';

/** Row-major source-normalized to composition-normalized projective transform. */
export type TrackingSourceTransform = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Durable authoring link from any ordinary timeline layer to an already solved
 * terrain track on a video clip. The linked mesh remains owned by the video
 * track; this record deliberately contains no geometry or runtime texture.
 */
export interface TerrainAttachment {
  version: 1;
  targetVideoClipId: string;
  trackId: string;
  /** Uses a local contact patch when present; omitted means the track-wide mesh. */
  footstepId?: string;
  placement: TerrainPlacement;
  visible: boolean;
}

/** Keeps ordinary 2D content readable while its origin follows the terrain. */
export interface TerrainScreenAnchor {
  attachment: TerrainAttachment;
  /** Composition-normalized offset from the projected terrain contact. */
  offset: { x: number; y: number };
  /** Optional normalized safe area for the tracked content center. */
  contentBounds?: { left: number; top: number; right: number; bottom: number };
  /** Optional automatic label layout; dimensions are normalized to the video. */
  labelLayout?: { group: string; width: number; height: number };
}

/** Draws a screen-space link from the named anchored card to its terrain contact. */
export interface TerrainAnchorConnector {
  anchorClipId: string;
  color: string;
  width: number;
  opacity: number;
}

/** Runtime-only render data. GPU resources are supplied by the compositor. */
export interface TerrainProjectionDescriptor {
  attachment: TerrainAttachment;
  terrain: TerrainReconstruction;
  /** Set only after resolving the target video's actual displayed frame. */
  camera?: TerrainCamera;
  sourcePresentedTime?: number;
  sourceTransform?: TrackingSourceTransform;
  /** Runtime-only normalized visible content rect, used for generated canvases with transparent padding. */
  contentBounds?: { x: number; y: number; width: number; height: number };
}

/** Runtime-only planar projection resolved from a reusable tracking asset. */
export interface PlanarTrackingProjectionDescriptor {
  binding: TrackingBinding;
  track: PlanarTrack;
  sourcePresentedTime?: number;
  /** Composition-normalized projective content quad, populated by the compositor. */
  quad?: SurfaceQuad;
}

/** Runtime-only screen-facing anchor resolved from a reusable tracking asset. */
export interface TrackingScreenAnchorDescriptor {
  binding: TrackingBinding;
  track: PlanarTrack;
  sourcePresentedTime?: number;
}

export function cloneTerrainAttachment(attachment: TerrainAttachment | undefined): TerrainAttachment | undefined {
  return attachment ? structuredClone(attachment) : undefined;
}

export function cloneTerrainScreenAnchor(anchor: TerrainScreenAnchor | undefined): TerrainScreenAnchor | undefined {
  return anchor ? structuredClone(anchor) : undefined;
}

export function cloneTerrainAnchorConnector(connector: TerrainAnchorConnector | undefined): TerrainAnchorConnector | undefined {
  return connector ? structuredClone(connector) : undefined;
}
