import type { EffectOperatorGraph, OperatorGroup } from '../../types/operatorGraph';
import { createDefaultGaussianBlurGraph } from './blurEffectGraphs';
import { sameCompositionNode } from './operatorComposition';

const original = createDefaultGaussianBlurGraph();
const cache = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
/** Organize only the original executable graph. Custom wiring/groups and explicit ungrouping win. */
export function organizeGaussianBlurGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.gaussianBlurPresentation === 1 || source.groups?.length || source.incomplete || source.samplingCompositionRules) return source;
  const cached = cache.get(source); if (cached) return cached;
  if (source.nodes.length !== original.nodes.length || source.edges.length !== original.edges.length
    || original.nodes.some(node => !source.nodes.some(actual => actual.id === node.id && sameCompositionNode(actual, node)))
    || original.edges.some(edge => !source.edges.some(actual => actual.from === edge.from && actual.output === edge.output
      && actual.to === edge.to && actual.input === edge.input))) return source;
  const area = (id: string, label: string, nodeIds: string[]): OperatorGroup => ({
    id: `gaussian-${id}`, label, color: '#6b99bd', nodeIds, collapsedByDefault: true,
  });
  const groups = [
    area('controls', 'Radius & Sample Count', ['radius', 'samples', 'minimum-samples', 'samples-at-least-one',
      'maximum-samples', 'samples-over-maximum', 'clamped-samples', 'extent']),
    area('sampling', 'Kernel Sampling', ['uv', 'resolution', 'index', 'one', 'one-vec2', 'texel-size', 'offset',
      'radius-per-sample', 'radius-per-sample-vec2', 'scaled-offset', 'sample-uv', 'sample']),
    area('weight', 'Gaussian Weight', ['three', 'sigma', 'two', 'two-sigma', 'two-sigma-squared',
      'distance-squared', 'zero', 'negative-distance', 'exponent', 'weight']),
    area('resolve', 'Weighted Blur & Bypass', ['reduce', 'weight-vec4', 'average', 'blurred', 'half', 'enabled', 'selected']),
  ];
  const result: EffectOperatorGraph = { ...source, gaussianBlurPresentation: 1, groups };
  cache.set(source, result); cache.set(result, result);
  return result;
}
