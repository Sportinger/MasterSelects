import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Rom1's Gain knee: the lift equals Gain up to ROM1_GAIN_KNEE, then eases toward ROM1_GAIN_REACH. */
export const ROM1_GAIN_KNEE = 0.25;
export const ROM1_GAIN_REACH = 0.5;

/** The lift Rom1 adds for a Gain: max(Gain, 0) up to the knee, then knee + room (1 - exp(-(g - knee) / room)). */
export function rom1GainLift(gain: number): number {
  const g = Math.max(Number.isFinite(gain) ? gain : 0, 0), room = ROM1_GAIN_REACH - ROM1_GAIN_KNEE;
  return Math.min(g, ROM1_GAIN_KNEE) + room * (1 - Math.exp(-Math.max(g - ROM1_GAIN_KNEE, 0) / room));
}

const clamped = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
const kneed = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

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
 * the whole frame white. Gain now passes a knee (rom1GainLift): values up to ROM1_GAIN_KNEE lift
 * exactly as before, so typical saved looks stay the same, and larger ones ease toward
 * ROM1_GAIN_REACH, so no value blanks the picture. Saved Rom1 graphs (safe-gain feeding gain-rgb
 * directly) get the knee inserted on load; the default graph is built the same way.
 */
export function kneeRom1GainGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  const known = kneed.get(source); if (known) return known;
  const into = source.edges.find(edge => edge.from === 'safe-gain' && edge.to === 'gain-rgb');
  if (!formerSafeGain(source) || !into || source.nodes.some(item => item.id === 'gain-knee')) { kneed.set(source, source); return source; }
  const node = (id: string, operator: string, value?: number): BoundOperatorNode =>
    ({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
  const edge = (from: string, to: string, input: string): OperatorEdge => ({ id: `${from}-value-${to}-${input}`, from, output: 'value', to, input });
  const at = source.layout?.['safe-gain'] ?? { x: 0, y: 0 };
  const added = [node('gain-knee-threshold', 'values.number', ROM1_GAIN_KNEE), node('gain-knee-room', 'values.number', ROM1_GAIN_REACH - ROM1_GAIN_KNEE),
    node('gain-knee-low', 'math.min.scalar'), node('gain-knee-over-raw', 'math.subtract.scalar'), node('gain-knee-over', 'math.max.scalar'),
    node('gain-knee-ratio', 'math.divide-ieee.scalar'), node('gain-knee-exponent', 'math.subtract.scalar'), node('gain-knee-decay', 'math.exp.scalar'),
    node('gain-knee-rest', 'math.subtract.scalar'), node('gain-knee-high', 'math.multiply.scalar'), node('gain-knee', 'math.add.scalar')];
  const result: EffectOperatorGraph = {
    ...source,
    nodes: [...source.nodes, ...added],
    edges: [...source.edges.filter(item => item !== into),
      edge('safe-gain', 'gain-knee-low', 'a'), edge('gain-knee-threshold', 'gain-knee-low', 'b'),
      edge('safe-gain', 'gain-knee-over-raw', 'a'), edge('gain-knee-threshold', 'gain-knee-over-raw', 'b'),
      edge('gain-knee-over-raw', 'gain-knee-over', 'a'), edge('zero', 'gain-knee-over', 'b'),
      edge('gain-knee-over', 'gain-knee-ratio', 'a'), edge('gain-knee-room', 'gain-knee-ratio', 'b'),
      edge('zero', 'gain-knee-exponent', 'a'), edge('gain-knee-ratio', 'gain-knee-exponent', 'b'),
      edge('gain-knee-exponent', 'gain-knee-decay', 'value'),
      edge('one', 'gain-knee-rest', 'a'), edge('gain-knee-decay', 'gain-knee-rest', 'b'),
      edge('gain-knee-rest', 'gain-knee-high', 'a'), edge('gain-knee-room', 'gain-knee-high', 'b'),
      edge('gain-knee-low', 'gain-knee', 'a'), edge('gain-knee-high', 'gain-knee', 'b'),
      { ...into, id: `gain-knee-value-gain-rgb-${into.input}`, from: 'gain-knee', output: 'value' }],
    layout: { ...source.layout, ...Object.fromEntries(added.map((item, index) => [item.id, { x: at.x + 60 * (index + 1), y: at.y + 120 }])) },
  };
  kneed.set(source, result); kneed.set(result, result);
  return result;
}
