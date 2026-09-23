import type { EffectOperatorGraph } from '../../../types/operatorGraph';

/** Only prune the generated map branch. Extra authored consumers retain their resource request. */
export function needsSlitScanTimeMedia(graph: EffectOperatorGraph | undefined, params: Record<string, unknown>): boolean {
  if (!graph) return true;
  const readers = graph.nodes.filter(node => node.operator === 'image.named-input' && node.bindings.resource === 'slit-scan:time-map');
  if (readers.some(node => node.id !== 'time-map-source')) return true;
  const sourceChoice = graph.nodes.find(node => node.id === 'time-field-mapSource');
  if (sourceChoice && (sourceChoice.operator !== 'values.choice' || sourceChoice.bindings.value !== 'mapSource')) return true;
  const generated = (id: string) => id.startsWith('time-map-') || id.startsWith('time-field-');
  if (graph.edges.some(edge => generated(edge.from) && !generated(edge.to)
    && !(['time-map-mix-0', 'time-map-mix-1'].includes(edge.from)
      && ['band-position', 'smooth-or-banded'].includes(edge.to)))) return true;
  return Number(params.mapAmount ?? 0) > 0 && (!sourceChoice || (params.mapSource ?? 'external') === 'external');
}
