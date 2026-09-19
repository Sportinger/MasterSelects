export interface Point2 {
  x: number;
  y: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export type Matrix3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface CameraPose {
  rotation: Matrix3;
  translation: Point3;
}

export interface FrameFeatures {
  sourceIndex: number;
  name: string;
  width: number;
  height: number;
  solveWidth: number;
  solveHeight: number;
  points: Float32Array;
  colors: Uint8Array;
}

export interface FeatureMatch {
  first: number;
  second: number;
  distance: number;
}

export interface PoseEstimate {
  pose: CameraPose;
  inlierIndices: number[];
}

export interface SparseObservation {
  frameIndex: number;
  featureIndex: number;
}

export interface SparsePoint {
  id: number;
  position: Point3;
  color: [number, number, number];
  error: number;
  observations: SparseObservation[];
}

export interface SparseReconstruction {
  frames: FrameFeatures[];
  poses: Map<number, CameraPose>;
  points: SparsePoint[];
  focalLength: number;
  principalPoint: Point2;
}
