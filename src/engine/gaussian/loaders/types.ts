// Gaussian Splat Loader type contracts

export type GaussianSplatFormat = 'ply' | 'splat' | 'ksplat' | 'gsplat-zip' | 'spz' | 'sog' | 'lcc';

export interface GaussianSplatMetadata {
  format: GaussianSplatFormat;
  splatCount: number;
  isTemporal: boolean;
  frameCount: number;
  fps: number;
  totalDuration: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  byteSize: number;
  perSplatByteStride: number;
  hasSphericalHarmonics: boolean;
  shDegree: number;
  compressionType: 'none' | 'quantized';
}

/** Canonical per-splat data: 14 floats = 56 bytes per splat
 *  [x, y, z, sx, sy, sz, r0, r1, r2, r3, r, g, b, opacity]
 *  Position(3), Scale(3), Rotation quat(4), Color DC(3), Opacity(1)
 */
export interface GaussianSplatBuffer {
  data: Float32Array;
  splatCount: number;
  shData?: Float32Array;
  shDegree: number;
}

export interface GaussianSplatFrame {
  index: number;
  buffer: GaussianSplatBuffer;
}

export interface GaussianSplatAsset {
  metadata: GaussianSplatMetadata;
  frames: GaussianSplatFrame[];
  sourceFile?: File;
  sourceUrl: string;
}

/** Internal: describes property layout discovered in a PLY header */
export interface PlyPropertyLayout {
  name: string;
  type: string;
  offset: number;
  size: number;
}

/** Internal: parsed PLY header info */
export interface PlyHeaderInfo {
  vertexCount: number;
  headerByteLength: number;
  properties: PlyPropertyLayout[];
  perVertexByteStride: number;
  hasSphericalHarmonics: boolean;
  shDegree: number;
}

/** Constants */
export const FLOATS_PER_SPLAT = 14;
export const BYTES_PER_SPLAT_CANONICAL = FLOATS_PER_SPLAT * 4; // 56 bytes
export const BYTES_PER_SPLAT_RAW = 32; // .splat format: 32 bytes per splat
export const SH_C0 = 0.28209479177387814;
