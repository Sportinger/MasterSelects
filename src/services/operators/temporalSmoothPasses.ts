import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';

export const TEMPORAL_SMOOTH_DEFAULT_AMOUNT = 0.6;
export const TEMPORAL_SMOOTH_MAX_AMOUNT = 0.98;
export const temporalHistoryResourceId = (nodeId: string) => `temporal-history:${nodeId}`;
/** The smoothed result is the materialized resource of the rewritten node itself. */
export const temporalSmoothResultId = (nodeId: string) => `image-resource:${nodeId}:image`;

/**
 * Lowers each Temporal Smooth node to ordinary image operators:
 * result = mix(current, previous result, amount * previous alpha), materialized
 * under the node's own ID so downstream edges stay untouched. Transparent
 * (cleared) history contributes nothing, so a reset shows the current frame.
 */
export function expandTemporalSmoothing(graph: EffectOperatorGraph): EffectOperatorGraph {
  const smoothing = (operator: string) => operator === 'image.temporal-smooth' || operator === 'image.temporal-smooth.scalar';
  if (!graph.nodes.some(node => smoothing(node.operator))) return graph;
  const result = structuredClone(graph);
  for (const target of result.nodes.filter(node => smoothing(node.operator))) {
    const scalar = target.operator === 'image.temporal-smooth.scalar';
    const input = result.edges.find(edge => edge.to === target.id && edge.input === (scalar ? 'value' : 'image'));
    if (!input) continue; // Canonical validation reports the missing input.
    const amountEdge = result.edges.find(edge => edge.to === target.id && edge.input === 'amount');
    const id = (part: string) => `__temporal:${target.id}:${part}`;
    const add = (part: string, operator: string, extra: Partial<BoundOperatorNode> = {}) => {
      if (result.nodes.some(node => node.id === id(part))) throw new Error('Temporal smoothing node ID collision.');
      result.nodes.push({ id: id(part), operator, operatorVersion: 1, bindings: {}, ...extra });
      return id(part);
    };
    const edge = (from: string, output: string, to: string, inputPort: string) =>
      result.edges.push({ id: `${from}:${output}->${to}:${inputPort}`, from, output, to, input: inputPort });
    const history = add('history', 'image.temporal-history', { bindings: { resource: temporalHistoryResourceId(target.id) } });
    const current = add('current', 'convert.image-to-vec4'), previous = add('previous', 'convert.image-to-vec4');
    const parts = add('previous-parts', 'vector.split.vec4'), weight = add('weight', 'math.multiply.scalar');
    const mixed = add('mix', 'math.mix.vec4'), image = add('image', 'convert.vec4-to-image');
    if (scalar) {
      // Opaque grey value: history alpha stays 1 wherever a value was written.
      const one = add('one', 'values.number', { constants: { value: 1 } }), packed = add('packed', 'vector.combine.vec4');
      for (const component of ['x', 'y', 'z']) edge(input.from, input.output, packed, component);
      edge(one, 'value', packed, 'w');
      const packedImage = add('packed-image', 'convert.vec4-to-image');
      edge(packed, 'value', packedImage, 'value');
      edge(packedImage, 'image', current, 'image');
      // Downstream value consumers read channel X of the materialized result.
      const resultVec = add('result', 'convert.image-to-vec4'), resultParts = add('result-parts', 'vector.split.vec4');
      edge(target.id, 'image', resultVec, 'image'); edge(resultVec, 'value', resultParts, 'value');
      for (const item of result.edges) if (item.from === target.id && item.output === 'value') { item.from = resultParts; item.output = 'x'; }
    } else edge(input.from, input.output, current, 'image');
    edge(history, 'image', previous, 'image');
    edge(previous, 'value', parts, 'value');
    if (amountEdge) edge(amountEdge.from, amountEdge.output, weight, 'a');
    else {
      const binding = target.bindings.amount, literal = target.constants?.amount;
      const value = typeof literal === 'number' && Number.isFinite(literal) ? literal : TEMPORAL_SMOOTH_DEFAULT_AMOUNT;
      const amount = add('amount', 'values.number', typeof binding === 'string'
        ? { bindings: { value: binding }, constants: { value } }
        : { constants: { value: Math.max(0, Math.min(TEMPORAL_SMOOTH_MAX_AMOUNT, value)) } });
      edge(amount, 'value', weight, 'a');
    }
    edge(parts, 'w', weight, 'b');
    edge(current, 'value', mixed, 'a');
    edge(previous, 'value', mixed, 'b');
    edge(weight, 'value', mixed, 't');
    edge(mixed, 'value', image, 'value');
    result.edges = result.edges.filter(item => item !== input && item !== amountEdge);
    edge(image, 'image', target.id, 'image');
    target.operator = 'image.materialize'; target.bindings = {}; target.constants = {};
  }
  return result;
}
