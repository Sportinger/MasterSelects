import type {
  ReplicatorBounds,
  ReplicatorDiagnostic,
} from '../../../services/motionDesign/replicator/contracts';

export const MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE = 12 as const;
export const MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE = (
  MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT
);
export const MOTION_REPLICATOR_MIN_BUFFER_CAPACITY = 64 as const;
export const MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY = 100_000 as const;

export type ReplicatorRuntimeDiagnosticCode =
  | 'MOTION_REPLICATOR_RENDERER_TRUNCATED'
  | 'MOTION_REPLICATOR_BUFFER_CAPACITY_EXCEEDED'
  | 'MOTION_REPLICATOR_INVALID_RENDER_INPUT'
  | 'MOTION_REPLICATOR_TEXTURE_DIMENSION_EXCEEDED'
  | 'MOTION_REPLICATOR_TEXTURE_PIXEL_BUDGET_EXCEEDED';

export interface ReplicatorRuntimeDiagnostic {
  code: ReplicatorRuntimeDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  limit?: number;
  actual?: number;
}

export interface ReplicatorViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ReplicatorInstanceDataLayout {
  readonly strideFloats: typeof MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE;
  readonly fields: readonly [
    'matrix.m00',
    'matrix.m01',
    'matrix.m10',
    'matrix.m11',
    'matrix.tx',
    'matrix.ty',
    'opacity',
    'normalizedIndex',
    'bounds.minX',
    'bounds.minY',
    'bounds.maxX',
    'bounds.maxY',
  ];
}

const MOTION_REPLICATOR_INSTANCE_FIELDS = [
  'matrix.m00',
  'matrix.m01',
  'matrix.m10',
  'matrix.m11',
  'matrix.tx',
  'matrix.ty',
  'opacity',
  'normalizedIndex',
  'bounds.minX',
  'bounds.minY',
  'bounds.maxX',
  'bounds.maxY',
] as const;

Object.freeze(MOTION_REPLICATOR_INSTANCE_FIELDS);

export const MOTION_REPLICATOR_INSTANCE_DATA_LAYOUT: ReplicatorInstanceDataLayout = Object.freeze({
  strideFloats: MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
  fields: MOTION_REPLICATOR_INSTANCE_FIELDS,
});

export interface ReplicatorRenderPacketStats {
  requestedInstances: number;
  effectiveInstances: number;
  submittedInstances: number;
  visibleInstances: number;
  culledInstances: number;
  truncatedInstances: number;
  encodedFloats: number;
  encodedBytes: number;
}

export interface SuccessfulReplicatorRenderPacket {
  ok: true;
  cacheIdentity: string;
  revision: number;
  instanceDataLayout: ReplicatorInstanceDataLayout;
  /** Dense visible-instance records, never one object per draw instance. */
  instanceData: Float32Array;
  /** Maps every dense record back to its stable requested-sequence index. */
  stableIndices: Uint32Array;
  contentBounds: ReplicatorBounds | null;
  diagnostics: readonly (ReplicatorDiagnostic | ReplicatorRuntimeDiagnostic)[];
  stats: ReplicatorRenderPacketStats;
}

export interface FailedReplicatorRenderPacket {
  ok: false;
  cacheIdentity: null;
  revision: null;
  instanceDataLayout: ReplicatorInstanceDataLayout;
  instanceData: Float32Array;
  stableIndices: Uint32Array;
  contentBounds: null;
  diagnostics: readonly ReplicatorRuntimeDiagnostic[];
  stats: ReplicatorRenderPacketStats;
}

export type ReplicatorRenderPacket =
  | SuccessfulReplicatorRenderPacket
  | FailedReplicatorRenderPacket;

export interface ReplicatorDirtyUploadRange {
  instanceStart: number;
  instanceCount: number;
  byteOffset: number;
  byteLength: number;
}

export interface ReplicatorBufferUpdateStats {
  cacheHit: boolean;
  reallocated: boolean;
  previousCapacity: number;
  capacity: number;
  usedInstances: number;
  allocatedBytes: number;
  uploadedBytes: number;
  uploadRangeCount: number;
  cumulativeCacheHits: number;
  cumulativeCacheMisses: number;
  cumulativeReallocations: number;
  cumulativeUploadedBytes: number;
}

export interface ReplicatorBufferUpdate {
  cacheIdentity: string;
  data: Float32Array;
  dirtyRanges: readonly ReplicatorDirtyUploadRange[];
  stats: ReplicatorBufferUpdateStats;
}

export interface ReplicatorSourceTexturePlan {
  ok: boolean;
  width: number;
  height: number;
  strokePadding: number;
  pixelCount: number;
  diagnostics: readonly ReplicatorRuntimeDiagnostic[];
}
