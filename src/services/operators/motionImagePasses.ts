import type { EffectOperatorGraph } from '../../types/operatorGraph';

/** Compiler-owned barriers make neighborhood operators reusable without
 * recursively re-evaluating upstream effects for every analysis/filter tap. */
export function materializeMotionImages(graph: EffectOperatorGraph, params: Record<string, unknown> = {}): EffectOperatorGraph {
  const targets = graph.nodes.filter(node => ['image.optical-flow', 'image.source-motion', 'image.motion-consistency', 'image.directional-smooth'].includes(node.operator));
  if (!targets.length) return graph;
  const result = structuredClone(graph);
  const add = (id: string, from: string, output: string, maxEdge = 0) => {
    if (result.nodes.some(node => node.id === id)) throw new Error('Motion materialization node ID collision.');
    result.nodes.push({ id, operator: 'image.materialize', operatorVersion: 1, bindings: {}, constants: { maxEdge } });
    result.edges.push({ id: `${id}:image`, from, output, to: id, input: 'image' });
  };
  for (const target of targets) {
    const disBinding = target.bindings.denseInverseSearch;
    // Cached DIS is only a texture lookup. Evaluate it at every output pixel's
    // actual source time; decimating this temporal lookup loses thin scan detail.
    if (target.operator === 'image.source-motion' && (typeof disBinding === 'string'
      ? params[disBinding] : target.constants?.denseInverseSearch) === true) continue;
    const optical = target.operator === 'image.optical-flow' || target.operator === 'image.source-motion';
    const analysis = optical || target.operator === 'image.motion-consistency';
    for (const input of target.operator === 'image.source-motion' ? [] : optical ? ['reference', 'target'] : ['image']) {
      const edge = result.edges.find(item => item.to === target.id && item.input === input);
      if (!edge) continue; // Canonical validation reports the missing input.
      const id = `__motion-input:${target.id}:${input}`;
      add(id, edge.from, edge.output, analysis ? 320 : 0);
      edge.from = id; edge.output = 'image';
    }
    if (analysis) {
      const id = `__motion-field:${target.id}`;
      for (const edge of result.edges) if (edge.from === target.id) { edge.from = id; edge.output = 'image'; }
      add(id, target.id, 'image', 320);
    }
  }
  return result;
}
