import type { EffectOperatorGraph, OperatorEndpoint } from './operatorGraph';

/** One authoritative driver per canonical property. Local values/keys stay with their owner. */
export interface ParameterSourceBinding {
  source?: OperatorEndpoint;
  enabled?: boolean;
  localMode?: 'auto' | 'constant';
  exposed?: boolean;
}

/** Clip-owned scalar control graph; no resources, sampled values or duplicate curves. */
export interface ParameterSources {
  version: 1;
  graph: EffectOperatorGraph;
  targets: Record<string, ParameterSourceBinding>;
  /** Authored clip-time origin retained across split and leading-edge trim. */
  clipTimeOffset: number;
}

export type ParameterSourceKind = 'constant' | 'keyframes' | 'node';
export interface ParameterSourceResult {
  value: number;
  kind: ParameterSourceKind;
  source?: OperatorEndpoint;
}
