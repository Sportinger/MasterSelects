import type { FlockParamValue, FlockPortType } from '../../../types/flock';

/**
 * JSON operator contracts. Implementations (compiler lowering, GPU passes)
 * live in runtime modules and look operators up by id.
 */

export type FlockParamType = 'number' | 'integer' | 'boolean' | 'enum' | 'vec3' | 'color' | 'asset';

/**
 * What a parameter change invalidates:
 * - appearance: rerender only
 * - derived: rebuild links/trails, keep motion
 * - behavior: resimulate from the earliest affected step
 * - topology: resimulate from initialization (seed, capacity, structure)
 */
export type FlockInvalidation = 'appearance' | 'derived' | 'behavior' | 'topology';

export interface FlockParamOption {
  value: string;
  label: string;
}

export interface FlockParamDescriptor {
  id: string;
  label: string;
  type: FlockParamType;
  default: FlockParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: FlockParamOption[];
  /** Continuous values are keyframeable; structural values are not. */
  animatable: boolean;
  invalidation: FlockInvalidation;
  assetKind?: 'model' | 'image' | 'audio';
  advanced?: boolean;
  description?: string;
}

export interface FlockPortDescriptor {
  id: string;
  label: string;
  type: FlockPortType;
  required?: boolean;
  /** Repeated inputs accept many edges, evaluated in definition edge order. */
  repeated?: boolean;
  /** Scalar input that replaces the named parameter's value while connected. */
  drivesParam?: string;
}

export type FlockOperatorCategory =
  | 'population'
  | 'behavior'
  | 'guidance'
  | 'selection'
  | 'values'
  | 'simulation'
  | 'render'
  | 'output'
  | 'groups';

export type FlockOperatorPhase = 'init' | 'step' | 'derived' | 'render' | 'value' | 'output' | 'structure';

export type FlockBypassContract =
  | { kind: 'passthrough'; input: string; output: string }
  | { kind: 'mute' }
  | { kind: 'none' };

export interface FlockOperatorDescriptor {
  sharedOperator?: string;
  id: string;
  version: number;
  label: string;
  category: FlockOperatorCategory;
  description: string;
  phase: FlockOperatorPhase;
  inputs: FlockPortDescriptor[];
  outputs: FlockPortDescriptor[];
  params: FlockParamDescriptor[];
  bypass: FlockBypassContract;
  /** Upper bound per compiled graph (after group expansion). */
  maxInstances?: number;
}

export const FLOCK_CATEGORY_LABELS: Record<FlockOperatorCategory, string> = {
  population: 'Population',
  behavior: 'Behavior',
  guidance: 'Guidance',
  selection: 'Selection',
  values: 'Values',
  simulation: 'Simulation',
  render: 'Render',
  output: 'Output',
  groups: 'Groups',
};
