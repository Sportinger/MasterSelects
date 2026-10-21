import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Largest lift of Rom1's Gain shoulder: the smoke Acuarela's own maximum (Gain 1 x 0.35). */
export const ROM1_GAIN_REACH = 0.35;

const clamped = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
const shouldered = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/** The former `safe-gain = max(gain, 0)` of a smoke graph, with its two input edges. */
function formerSafeGain(source: EffectOperatorGraph) {
  const node = source.nodes.find(item => item.id === 'safe-gain');
  const a = source.edges.find(edge => edge.to === 'safe-gain' && edge.input === 'a');
  const b = source.edges.find(edge => edge.to === 'safe-gain' && edge.input === 'b');
  const has = (id: string, value: number) => source.nodes.some(item => item.id === id && item.operator === 'values.number' && item.constants?.value === value);
  return node?.operator === 'math.max.scalar' && a?.from === 'gain' && b && has('zero', 0) && has('one', 1) ? { node, a, b } : undefined;
}

/**
 * The smoke-recipe Acuarela adds 0.35 x Gain to every pixel; its graph clamps Gain to 0..1
 * (`safe-gain` is math.clamp.scalar). Graphs saved with `max(gain, 0)` get the clamp on load;
 * any other wiring is user work and stays as saved (the inspector still names the value).
 */
export function clampSmokeGainGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  const known = clamped.get(source); if (known) return known;
  const former = formerSafeGain(source);
  if (!former) { clamped.set(source, source); return source; }
  const result: EffectOperatorGraph = {
    ...source,
    nodes: source.nodes.map(item => item === former.node ? { ...item, operator: 'math.clamp.scalar' } : item),
    edges: [
      ...source.edges.map(edge => edge === former.a ? { ...edge, id: `${edge.from}-${edge.output}-safe-gain-value`, input: 'value' }
        : edge === former.b ? { ...edge, id: `${edge.from}-${edge.output}-safe-gain-min`, input: 'min' } : edge),
      { id: 'one-value-safe-gain-max', from: 'one', output: 'value', to: 'safe-gain', input: 'max' },
    ],
  };
  clamped.set(source, result); clamped.set(result, result);
  return result;
}

/**
 * Rom1 adds Gain to every pixel; its feedback keeps the brightest value, so a Gain near 1 turned
 * the whole frame white. Gain now passes a soft shoulder, lift = R (1 - exp(-max(Gain, 0) / R)) with
 * R = ROM1_GAIN_REACH: small values are unchanged (Gain 0.01 lifts 0.0099), large ones ease toward R,
 * so no value blanks the picture. Saved Rom1 graphs (safe-gain feeding gain-rgb directly) get the
 * shoulder inserted on load; the default graph is built the same way.
 */
export function shoulderRom1GainGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  const known = shouldered.get(source); if (known) return known;
  const into = source.edges.find(edge => edge.from === 'safe-gain' && edge.to === 'gain-rgb');
  if (!formerSafeGain(source) || !into || source.nodes.some(item => item.id === 'gain-shoulder')) { shouldered.set(source, source); return source; }
  const node = (id: string, operator: string, value?: number): BoundOperatorNode =>
    ({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
  const edge = (from: string, to: string, input: string): OperatorEdge => ({ id: `${from}-value-${to}-${input}`, from, output: 'value', to, input });
  const at = source.layout?.['safe-gain'] ?? { x: 0, y: 0 };
  const added = [node('gain-shoulder-reach', 'values.number', ROM1_GAIN_REACH), node('gain-shoulder-ratio', 'math.divide-ieee.scalar'),
    node('gain-shoulder-exponent', 'math.subtract.scalar'), node('gain-shoulder-decay', 'math.exp.scalar'),
    node('gain-shoulder-rest', 'math.subtract.scalar'), node('gain-shoulder', 'math.multiply.scalar')];
  const result: EffectOperatorGraph = {
    ...source,
    nodes: [...source.nodes, ...added],
    edges: [...source.edges.filter(item => item !== into),
      edge('safe-gain', 'gain-shoulder-ratio', 'a'), edge('gain-shoulder-reach', 'gain-shoulder-ratio', 'b'),
      edge('zero', 'gain-shoulder-exponent', 'a'), edge('gain-shoulder-ratio', 'gain-shoulder-exponent', 'b'),
      edge('gain-shoulder-exponent', 'gain-shoulder-decay', 'value'),
      edge('one', 'gain-shoulder-rest', 'a'), edge('gain-shoulder-decay', 'gain-shoulder-rest', 'b'),
      edge('gain-shoulder-rest', 'gain-shoulder', 'a'), edge('gain-shoulder-reach', 'gain-shoulder', 'b'),
      { ...into, id: `gain-shoulder-value-gain-rgb-${into.input}`, from: 'gain-shoulder', output: 'value' }],
    layout: { ...source.layout, ...Object.fromEntries(added.map((item, index) => [item.id, { x: at.x + 60 * (index + 1), y: at.y + 120 }])) },
  };
  shouldered.set(source, result); shouldered.set(result, result);
  return result;
}
