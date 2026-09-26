import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { temporalDemandGraph } from '../../../services/operators/temporalDemandGraph';
import { temporalSourceTime, type TemporalClipSource } from '../temporalClipSource';

/** Persisted values only. The reference projection is fixed in object-local space. */
export interface SlitScanGeometrySettings {
  version: 1;
  mode: '2d' | 'time-surface' | 'motion-band' | 'motion-surface' | 'space-time';
  baseSamplerId: string;
  reference: {
    projection: 'perspective' | 'orthographic';
    viewProjection: number[];
    inverseViewProjection: number[];
    near: number;
    far: number;
  };
  timeDepth: number;
  flowDepth: number;
  smoothing: number;
  maxGridCells: number;
}

/** No display transform: RG = sample UV, B = graph delay, A is NOT validity. */
export function slitScanGeometryQuery(graph: EffectOperatorGraph, baseSamplerId: string): EffectOperatorGraph {
  if (!baseSamplerId.trim()) throw new Error('Select an explicit Slit Scan geometry base sampler.');
  return temporalDemandGraph(graph, baseSamplerId);
}

/** Continuous requested age, deliberately distinct from discrete color contributions. */
export function slitScanGeometryAge(source: TemporalClipSource, delay: number, timeFactor: number): number {
  if (!Number.isFinite(delay) || !Number.isFinite(timeFactor) || timeFactor <= 0) {
    throw new Error('Slit Scan geometry requires a finite delay and positive time factor.');
  }
  return temporalSourceTime(source, source.localTime)
    - temporalSourceTime(source, source.localTime - timeFactor * delay);
}

/** Runtime-only resources borrowed until the producing owner's next resolve/release. */
export interface SlitScanGeometryFrame {
  identity: string;
  ownerId: string;
  outputTime: number;
  baseSamplerId: string;
  source: TemporalClipSource;
  timeFactor: number;
  color: GPUTextureView;
  /** Float numeric field; no tone mapping, color correction, or UNORM conversion. */
  query: GPUTextureView;
  /** Owner metadata retains exact source PTS and reconstruction weights. */
  contributions: GPUTextureView;
  sampling: import('../TemporalSampleMetadata').TemporalSampleMetadata;
  motion?: {
    field: GPUTextureView;
    analysisIdentity: string;
    coordinates: 'source' | 'stabilized-reference';
    velocityUnit: 'uv-per-graph-delay-second';
  };
}

/** A pending frame cannot accidentally combine a new color with old geometry. */
export type SlitScanGeometryResult =
  | { status: 'ready'; frame: SlitScanGeometryFrame }
  | { status: 'preparing'; message: string }
  | { status: 'error'; message: string };
