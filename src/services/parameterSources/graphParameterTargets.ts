import type { Effect } from '../../types/effects';
import { effectOperatorGraph, hasEffectOperatorGraph } from '../operators/effectGraphOwner';
import { exposedGraphValues } from '../operators/exposedGraphValueList';
import { getEffectOperator } from '../operators/operatorRegistry';
import type { ParameterSourceTarget } from './parameterSourceTargets';

/**
 * Exposed Value nodes of any effect-owned operator graph (Weave's Reveal, Weave Speed and
 * Irregularity, image graph values, …) as drivable targets. Their effect parameter is what the graph
 * reads, so a driven value reaches every executor through the shared effect override.
 */
export function graphParameterTargets(effect: Effect): ParameterSourceTarget[] {
  if (!hasEffectOperatorGraph(effect.type)) return [];
  let graph;
  try { graph = effectOperatorGraph(effect, { inspectionOnly: true }); } catch { return []; }
  return exposedGraphValues(graph).map(value => {
    const node = graph.nodes.find(candidate => candidate.id === value.nodeId);
    // A bound value falls back to the operator default, as sampleOperatorParameter does.
    const fallback = Number(getEffectOperator(node?.operator ?? '')?.parameters.find(parameter => parameter.id === 'value')?.default ?? 0);
    const stored = effect.params[value.key];
    return { path: `effect.${effect.id}.${value.key}`, label: value.label, group: effect.name,
      value: typeof stored === 'number' ? stored : fallback, defaultValue: fallback,
      min: value.min, max: value.max, step: value.step, unit: 'number' };
  });
}
