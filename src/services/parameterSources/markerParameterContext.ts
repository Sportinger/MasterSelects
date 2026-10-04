import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { MarkerSample } from './controlSignalMath';

export type MarkerParameterContext = readonly MarkerSample[];
const snapshots = new WeakMap<EffectOperatorGraph, MarkerParameterContext>();

/** Export pins the markers of the owning composition; never serialized into project graphs. */
export function freezeMarkerParameterContext(graph: EffectOperatorGraph, markers: readonly MarkerSample[]): void {
  snapshots.set(graph, markers.map(marker => ({ time: marker.time, label: marker.label })));
}
export function frozenMarkerParameterContext(graph: EffectOperatorGraph): MarkerParameterContext | undefined {
  return snapshots.get(graph);
}
export function copyMarkerParameterContext(from: EffectOperatorGraph, to: EffectOperatorGraph): void {
  const context = snapshots.get(from);
  if (context) snapshots.set(to, context);
}
export function usesMarkerParameters(graph: EffectOperatorGraph | undefined): boolean {
  return Boolean(graph?.nodes.some(node => node.operator === 'control.marker-trigger'));
}
