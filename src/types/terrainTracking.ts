/** Serializable reconstruction in COLMAP coordinates: +X right, +Y down, +Z forward. */
export type TerrainVector = [number, number, number];
export interface TerrainCamera {
  time: number;
  duration: number;
  rotation: [number, number, number, number, number, number, number, number, number];
  translation: TerrainVector;
  error: number;
  observations: number;
  /** Frame-specific foreground quads in normalized source-image coordinates. */
  occluders?: [number, number][][];
}
export interface TerrainIntrinsics {
  width: number; height: number;
  fx: number; fy: number; cx: number; cy: number;
  k1?: number;
}
export interface DenseTerrainMesh {
  positions: number[];
  indices: number[];
  /** Orthonormal ground frame, all in reconstruction units. */
  origin: TerrainVector;
  axisX: TerrainVector;
  axisY: TerrainVector;
  normal: TerrainVector;
  size: [number, number];
}
export interface TerrainPlacement {
  x: number; y: number; width: number; height: number; rotation: number;
  /** Ground-plane contour in normalized marker coordinates. */
  contour?: [number, number][];
  contactTime?: number;
  /** Optional authored decision time and readable label center in footprint UV. */
  lockTime?: number;
  labelX?: number;
  labelY?: number;
  profile?: 'hiking';
  side?: 'left' | 'right';
}
export interface TerrainFootstep {
  id: string;
  name: string;
  placement: TerrainPlacement;
  /** Local observed ground patch and projector frame for this contact. */
  mesh?: DenseTerrainMesh;
}
export interface TerrainVertex {
  position: TerrainVector;
  /** Homogeneous reference-projector UV; preserves perspective over uneven geometry. */
  uvq: TerrainVector;
}
export interface TerrainReconstruction {
  version: 1;
  solver: 'browser-sfm' | 'colmap-openmvs';
  denseMesh?: DenseTerrainMesh;
  footsteps?: TerrainFootstep[];
  referenceTime: number;
  intrinsics: TerrainIntrinsics;
  cameras: TerrainCamera[];
  vertices: TerrainVertex[];
  triangles: number[];
  sourceFrameCount: number;
  sparsePointCount: number;
  medianError: number;
}
