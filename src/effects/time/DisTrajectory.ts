/** Borrowed device-local correspondences on actual adjacent source PTS pairs. */
export interface DisTrajectory {
  forward: GPUTextureView;
  backward: GPUTextureView;
  width: number;
  height: number;
  columns: number;
  rows: number;
  pairs: readonly { sourceTime: number; targetTime: number; slot: number }[];
  identity: string;
}
