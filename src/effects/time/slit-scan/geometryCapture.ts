import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { ImageGraphExternalResource, ImageGraphPassRuntime } from '../../ImageGraphPassRuntime';
import type { TemporalClipSource } from '../temporalClipSource';
import type { ImageOperatorPlan } from '../../../services/operators/imageOperatorGraph';

/** Synchronous borrow at the exact Slit Scan output boundary, before later effects. */
export interface SlitScanGeometryCapture {
  effect: { id: string; type: string; params: Record<string, unknown> };
  graph: EffectOperatorGraph;
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  sampler: GPUSampler;
  input: GPUTextureView;
  color: GPUTextureView;
  width: number;
  height: number;
  timelineTime: number;
  scopeId: string;
  source?: TemporalClipSource;
  /** Optional query already encoded for seam filtering in this same frame. */
  baseQuery?: { samplerId: string; view: GPUTextureView };
  resources: ReadonlyMap<string, ImageGraphExternalResource>;
  /** Exact color-sampler descriptors: never select the first history in a multi-query graph. */
  historyResources: readonly import('../../../services/operators/imageOperatorExternalResources').ImageOperatorInputHistoryResource[];
  passRuntime: ImageGraphPassRuntime;
  resolveResources: (plan: ImageOperatorPlan, resources: Map<string, ImageGraphExternalResource>, graph: EffectOperatorGraph) => boolean;
}

export type SlitScanGeometryCaptureSink = (frame: SlitScanGeometryCapture) => void;
