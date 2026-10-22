import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { MAX_POSTERIZE_SOFTNESS, MIN_POSTERIZE_LEVELS, SOFTNESS_FLOOR } from '../../effects/stylize/pointwiseModel';
import { BlurGraphBuilder, type GraphPort } from './blurGraphBuilder';

export type EditablePointwiseEffectType = 'threshold' | 'posterize';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const literal = (id: string, value: number) => node(id, 'values.number', {}, { value });
function graph(nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph {
  const ordered = [node('frame', 'image.frame'), node('split', 'vector.split.rgba'), ...nodes,
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: ordered,
    edges: [edge('frame', 'image', 'split', 'image'), ...edges, edge('split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')],
    layout: Object.fromEntries(ordered.map((item, index) => [item.id, { x: index * 260, y: ['split', 'combine'].includes(item.id) ? 0 : 180 }])) };
}

/** The earlier Threshold (before 2026-10-21): hard strict Rec.709 comparison. */
export function createEarlierThresholdGraph(): EffectOperatorGraph {
  return graph([node('luma', 'color.luminance-rec709.rgb'), node('level', 'values.number', { value: 'level' }),
    node('compare', 'compare.greater.scalar'), literal('black', 0), literal('white', 1), node('select', 'select.scalar'),
    node('result-rgb', 'convert.scalar-to-rgb')], [
    edge('split', 'rgb', 'luma', 'rgb'), edge('luma', 'value', 'compare', 'a'), edge('level', 'value', 'compare', 'b'),
    edge('black', 'value', 'select', 'falseValue'), edge('white', 'value', 'select', 'trueValue'), edge('compare', 'condition', 'select', 'condition'),
    edge('select', 'value', 'result-rgb', 'value'), edge('result-rgb', 'rgb', 'combine', 'rgb'),
  ]);
}

/** The earlier Posterize (before 2026-10-21): floor(rgb * L) / (L - 1), no final clamp. */
export function createEarlierPosterizeGraph(): EffectOperatorGraph {
  return graph([node('levels', 'values.number', { value: 'levels' }), literal('minimum-levels', 2), node('effective-levels', 'math.max.scalar'),
    node('levels-rgb', 'convert.scalar-to-rgb'), node('multiply', 'math.multiply.rgb'), node('floor', 'math.floor.rgb'), literal('one', 1),
    node('denominator', 'math.subtract.scalar'), node('denominator-rgb', 'convert.scalar-to-rgb'), node('divide', 'math.divide-ieee.rgb')], [
    edge('levels', 'value', 'effective-levels', 'a'), edge('minimum-levels', 'value', 'effective-levels', 'b'),
    edge('effective-levels', 'value', 'levels-rgb', 'value'), edge('split', 'rgb', 'multiply', 'a'), edge('levels-rgb', 'rgb', 'multiply', 'b'),
    edge('multiply', 'value', 'floor', 'value'), edge('effective-levels', 'value', 'denominator', 'a'), edge('one', 'value', 'denominator', 'b'),
    edge('denominator', 'value', 'denominator-rgb', 'value'), edge('floor', 'value', 'divide', 'a'), edge('denominator-rgb', 'rgb', 'divide', 'b'),
    edge('divide', 'value', 'combine', 'rgb'),
  ]);
}

export function createEarlierPointwiseEffectGraph(type: EditablePointwiseEffectType): EffectOperatorGraph {
  return type === 'threshold' ? createEarlierThresholdGraph() : createEarlierPosterizeGraph();
}

/** Smooth step of `t` (already clamped to 0-1): t * t * (3 - 2 t). */
function smoothRamp(g: BlurGraphBuilder, id: string, t: GraphPort, rgb: boolean): string {
  const [multiply, subtract] = rgb ? ['math.multiply.rgb', 'math.subtract.rgb'] : ['math.multiply.scalar', 'math.subtract.scalar'];
  const [three, two]: GraphPort[] = rgb ? [['three-rgb', 'rgb'], ['two-rgb', 'rgb']] : ['three', 'two'];
  return g.binary(id, multiply, g.binary(`${id}-square`, multiply, t, t),
    g.binary(`${id}-falloff`, subtract, three, g.binary(`${id}-double`, multiply, two, t)));
}

/**
 * Threshold v2 (contract in `effects/stylize/pointwiseModel.ts`): Rec.709 brightness against
 * Level; Softness widens the hard step into a smooth ramp of that brightness width. Softness 0
 * is exactly the earlier strict comparison. Alpha is kept.
 */
export function createDefaultThresholdGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('three', 3);
  const level = g.bound('level', 'level'), softness = g.bound('softness', 'softness');
  const source = g.add('split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const luma = g.add('luma', 'color.luminance-rec709.rgb', { rgb: [source, 'rgb'] });
  const hard = g.add('hard', 'select.scalar', { falseValue: 'zero', trueValue: 'one', condition: [g.binary('compare', 'compare.greater.scalar', luma, level), 'condition'] });
  // Smooth ramp across Level ± Softness / 2.
  const width = g.binary('ramp-width', 'math.max.scalar', softness, g.number('ramp-floor', SOFTNESS_FLOOR));
  const position = g.binary('ramp-position', 'math.add.scalar', g.binary('ramp-offset', 'math.divide-ieee.scalar',
    g.binary('ramp-distance', 'math.subtract.scalar', luma, level), width), 'half');
  const ramp = smoothRamp(g, 'ramp', g.add('ramp-clamped', 'math.clamp.scalar', { value: position, min: 'zero', max: 'one' }), false);
  const soft = g.add('soft', 'select.scalar', { falseValue: 'zero', trueValue: 'one', condition: [g.binary('soft-active', 'compare.greater.scalar', softness, 'zero'), 'condition'] });
  const value = g.add('value', 'math.mix.scalar', { a: hard, b: ramp, t: soft });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: [g.add('result-rgb', 'convert.scalar-to-rgb', { value }), 'rgb'], alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}

/**
 * Posterize v2 (contract in `effects/stylize/pointwiseModel.ts`): every channel snaps to Levels
 * even steps (floor(rgb * L) / (L - 1), limited to 0-1); Softness rounds each step into a smooth
 * ramp of that share of a step, which keeps gradients from tearing into hard contours. Brightness
 * Only posterizes the brightest channel and scales the colour with it, so hue and saturation stay
 * (no false colours where channels cross a step apart). Softness 0 without Brightness Only is
 * exactly the earlier staircase. Alpha is kept.
 */
export function createDefaultPosterizeGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.number('zero', 0); g.number('one', 1);
  g.number('half', .5); g.number('two', 2); g.number('three', 3);
  const half: GraphPort = [g.unary('half-rgb', 'convert.scalar-to-rgb', 'half'), 'rgb'];
  g.unary('two-rgb', 'convert.scalar-to-rgb', 'two'); g.unary('three-rgb', 'convert.scalar-to-rgb', 'three');
  const levels = g.binary('effective-levels', 'math.max.scalar', g.bound('levels', 'levels'), g.number('minimum-levels', MIN_POSTERIZE_LEVELS));
  const softness = g.bound('softness', 'softness');
  const source = g.add('split', 'vector.split.rgba', { image: ['frame', 'image'] });
  // Brightness Only: the staircase runs on the brightest channel instead of each channel.
  const brightnessOnly = g.add('brightness-only-share', 'select.scalar', { falseValue: 'zero', trueValue: 'one',
    condition: g.bound('brightness-only', 'brightnessOnly', 'values.boolean') });
  const brightness = g.add('brightness', 'vector.reduce-max.rgb', { rgb: [source, 'rgb'] });
  const input = g.add('posterize-input', 'math.mix.rgb', { a: [source, 'rgb'], b: [g.unary('brightness-rgb', 'convert.scalar-to-rgb', brightness), 'rgb'], t: brightnessOnly });
  const scaled = g.add('scaled', 'math.multiply.rgb-scalar', { a: input, b: levels });
  const hard = g.unary('hard', 'math.floor.rgb', scaled);
  // Smooth steps: the step boundary at each whole number of `scaled` becomes a ramp Softness wide.
  const shifted = g.binary('shifted', 'math.subtract.rgb', scaled, half);
  const base = g.unary('base', 'math.floor.rgb', shifted);
  const within = g.binary('within', 'math.subtract.rgb', shifted, base);
  // At most one step wide: wider ramps overlap their neighbours and jump mid-step (posterizeParamNotes says so).
  const width = g.add('ramp-width', 'math.clamp.scalar', { value: softness, min: g.number('ramp-floor', SOFTNESS_FLOOR),
    max: g.number('ramp-ceiling', MAX_POSTERIZE_SOFTNESS) });
  const position = g.binary('ramp-position', 'math.add.rgb', g.add('ramp-offset', 'math.divide-ieee.rgb-scalar', {
    a: g.binary('ramp-distance', 'math.subtract.rgb', within, half), b: width }), half);
  const ramp = smoothRamp(g, 'ramp', g.add('ramp-clamped', 'math.clamp.rgb-scalar', { value: position, min: 'zero', max: 'one' }), true);
  const smooth = g.binary('smooth', 'math.add.rgb', base, ramp);
  const soft = g.add('soft', 'select.scalar', { falseValue: 'zero', trueValue: 'one', condition: [g.binary('soft-active', 'compare.greater.scalar', softness, 'zero'), 'condition'] });
  const steps = g.add('steps', 'math.mix.rgb', { a: hard, b: smooth, t: soft });
  const divided = g.add('divide', 'math.divide-ieee.rgb-scalar', { a: steps, b: g.binary('denominator', 'math.subtract.scalar', levels, 'one') });
  const clamped = g.add('clamped', 'math.clamp.rgb-scalar', { value: divided, min: 'zero', max: 'one' });
  // Brightness Only: scale the colour so its brightest channel lands on the posterized brightness.
  const brightnessGain = g.binary('brightness-gain', 'math.divide-ieee.scalar', g.add('posterized-brightness', 'vector.reduce-max.rgb', { rgb: clamped }),
    g.binary('brightness-safe', 'math.max.scalar', brightness, g.number('brightness-floor', 1e-6)));
  const keptColour = g.add('kept-colour', 'math.clamp.rgb-scalar', { value: g.add('kept-colour-raw', 'math.multiply.rgb-scalar', { a: [source, 'rgb'], b: brightnessGain }),
    min: 'zero', max: 'one' });
  const result = g.add('result-rgb', 'math.mix.rgb', { a: clamped, b: keptColour, t: brightnessOnly });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: result, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}

/**
 * Posterize graphs saved between 2026-10-21 and 2026-10-22 widened the ramp without limit
 * (`ramp-width` = max(Softness, floor)), so Softness above 1 drew hard edges mid-step. This caps that
 * node at one step in place (same cards and positions; Softness 0 to 1 renders exactly as before).
 * Other graphs are returned unchanged.
 */
export function capPosterizeRampWidth(graph: EffectOperatorGraph): EffectOperatorGraph {
  const width = graph.nodes.find(item => item.id === 'ramp-width');
  if (!width || width.operator !== 'math.max.scalar' || graph.nodes.some(item => item.id === 'ramp-ceiling')) return graph;
  const into = graph.edges.filter(item => item.to === 'ramp-width');
  const a = into.find(item => item.input === 'a'), b = into.find(item => item.input === 'b');
  if (into.length !== 2 || a?.from !== 'softness' || b?.from !== 'ramp-floor') return graph;
  const at = graph.layout?.['ramp-floor'];
  const ceiling = literal('ramp-ceiling', MAX_POSTERIZE_SOFTNESS);
  return { ...graph,
    nodes: [...graph.nodes.map(item => item.id === 'ramp-width' ? { ...item, operator: 'math.clamp.scalar' } : item), ceiling],
    edges: [...graph.edges.filter(item => item !== a && item !== b), edge('softness', a.output, 'ramp-width', 'value'),
      edge('ramp-floor', b.output, 'ramp-width', 'min'), edge('ramp-ceiling', 'value', 'ramp-width', 'max')],
    layout: { ...graph.layout, 'ramp-ceiling': at ? { x: at.x, y: at.y + 120 } : { x: 0, y: 0 } },
    // The new constant joins the folder of the floor beside it.
    ...(graph.groups ? { groups: graph.groups.map(group => group.nodeIds.includes('ramp-floor') ? { ...group, nodeIds: [...group.nodeIds, 'ramp-ceiling'] } : group) } : {}) };
}

export function createDefaultPointwiseEffectGraph(type: EditablePointwiseEffectType): EffectOperatorGraph {
  return type === 'threshold' ? createDefaultThresholdGraph() : createDefaultPosterizeGraph();
}
