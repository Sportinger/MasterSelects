import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableContextualEffectType = 'vignette' | 'scanlines' | 'grain';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const literal = (id: string, value: number) => node(id, 'values.number', {}, { value });
const row = (ids: readonly string[], y: number) => Object.fromEntries(ids.map((id, index) => [id, { x: index * 300, y }]));

/** Exact legacy vignette math. UV is fragment context, deliberately not texture-transform UV. */
export function createDefaultVignetteGraph(): EffectOperatorGraph {
  const nodes = [
    node('frame', 'image.frame'), node('split', 'vector.split.rgba'), node('uv', 'image.normalized-uv'),
    literal('half', 0.5), node('half-vec2', 'convert.scalar-to-vec2'), node('center', 'math.subtract.vec2'),
    literal('one', 1), node('roundness', 'values.number', { value: 'roundness' }), node('aspect', 'vector.combine.vec2'),
    node('scaled-center', 'math.multiply.vec2'), node('radius', 'vector.length.vec2'), literal('two', 2),
    node('distance', 'math.multiply.scalar'), node('size', 'values.number', { value: 'size' }),
    node('softness', 'values.number', { value: 'softness' }), node('outer-edge', 'math.add.scalar'),
    node('edge-ramp', 'math.smoothstep.scalar'), node('factor', 'math.subtract.scalar'),
    node('amount', 'values.number', { value: 'amount' }), node('gain', 'math.mix.scalar'),
    node('gain-rgb', 'convert.scalar-to-rgb'), node('shade', 'math.multiply.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output'),
  ];
  return {
    version: 1, schemaVersion: 1, domain: 'image', nodes,
    edges: [
      edge('frame', 'image', 'split', 'image'), edge('uv', 'uv', 'center', 'a'), edge('half', 'value', 'half-vec2', 'value'),
      edge('half-vec2', 'value', 'center', 'b'), edge('one', 'value', 'aspect', 'x'), edge('roundness', 'value', 'aspect', 'y'),
      edge('center', 'value', 'scaled-center', 'a'), edge('aspect', 'value', 'scaled-center', 'b'),
      edge('scaled-center', 'value', 'radius', 'value'), edge('radius', 'value', 'distance', 'a'), edge('two', 'value', 'distance', 'b'),
      edge('size', 'value', 'outer-edge', 'a'), edge('softness', 'value', 'outer-edge', 'b'),
      edge('size', 'value', 'edge-ramp', 'edge0'), edge('outer-edge', 'value', 'edge-ramp', 'edge1'), edge('distance', 'value', 'edge-ramp', 'value'),
      edge('one', 'value', 'factor', 'a'), edge('edge-ramp', 'value', 'factor', 'b'),
      edge('one', 'value', 'gain', 'a'), edge('factor', 'value', 'gain', 'b'), edge('amount', 'value', 'gain', 't'),
      edge('gain', 'value', 'gain-rgb', 'value'), edge('split', 'rgb', 'shade', 'a'), edge('gain-rgb', 'rgb', 'shade', 'b'),
      edge('shade', 'value', 'combine', 'rgb'), edge('split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image'),
    ],
    layout: {
      frame: { x: 0, y: 0 }, split: { x: 260, y: 0 }, shade: { x: 1560, y: 0 },
      combine: { x: 1820, y: 0 }, output: { x: 2080, y: 0 },
      uv: { x: 0, y: 340 }, center: { x: 520, y: 340 }, aspect: { x: 780, y: 340 },
      'scaled-center': { x: 1040, y: 340 }, radius: { x: 1300, y: 340 }, distance: { x: 1560, y: 340 },
      'edge-ramp': { x: 1820, y: 340 }, factor: { x: 2080, y: 340 },
      half: { x: 0, y: 680 }, 'half-vec2': { x: 260, y: 680 }, one: { x: 520, y: 680 },
      roundness: { x: 780, y: 680 }, two: { x: 1300, y: 680 }, size: { x: 1560, y: 680 },
      'outer-edge': { x: 1820, y: 680 }, gain: { x: 2080, y: 680 },
      softness: { x: 1560, y: 1020 }, amount: { x: 1820, y: 1020 }, 'gain-rgb': { x: 2080, y: 1020 },
    },
  };
}

/** Exact legacy scanline phase and darkening, driven by deterministic timeline time. */
export function createDefaultScanlinesGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('split', 'vector.split.rgba'), node('uv', 'image.normalized-uv'), node('uv-split', 'vector.split.vec2'),
    node('time', 'image.timeline-time'), node('speed', 'values.number', { value: 'speed' }), literal('point-one', 0.1), node('time-speed', 'math.multiply.scalar'),
    node('scroll', 'math.multiply.scalar'), node('phase-y', 'math.add.scalar'), node('density', 'values.number', { value: 'density' }), node('density-phase', 'math.multiply.scalar'),
    literal('hundred', 100), node('angle', 'math.multiply.scalar'), node('wave', 'math.sin.scalar'), literal('half', 0.5), node('half-wave', 'math.multiply.scalar'),
    node('scanline', 'math.add.scalar'), literal('one', 1), node('inverse-scanline', 'math.subtract.scalar'), node('opacity', 'values.number', { value: 'opacity' }),
    node('attenuation', 'math.multiply.scalar'), node('darken', 'math.subtract.scalar'), node('darken-rgb', 'convert.scalar-to-rgb'), node('shade', 'math.multiply.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges: [
    edge('frame', 'image', 'split', 'image'), edge('uv', 'uv', 'uv-split', 'value'), edge('time', 'value', 'time-speed', 'a'), edge('speed', 'value', 'time-speed', 'b'),
    edge('time-speed', 'value', 'scroll', 'a'), edge('point-one', 'value', 'scroll', 'b'), edge('uv-split', 'y', 'phase-y', 'a'), edge('scroll', 'value', 'phase-y', 'b'),
    edge('phase-y', 'value', 'density-phase', 'a'), edge('density', 'value', 'density-phase', 'b'), edge('density-phase', 'value', 'angle', 'a'),
    edge('hundred', 'value', 'angle', 'b'), edge('angle', 'value', 'wave', 'value'), edge('wave', 'value', 'half-wave', 'a'), edge('half', 'value', 'half-wave', 'b'),
    edge('half-wave', 'value', 'scanline', 'a'), edge('half', 'value', 'scanline', 'b'), edge('one', 'value', 'inverse-scanline', 'a'),
    edge('scanline', 'value', 'inverse-scanline', 'b'), edge('opacity', 'value', 'attenuation', 'a'), edge('inverse-scanline', 'value', 'attenuation', 'b'),
    edge('one', 'value', 'darken', 'a'), edge('attenuation', 'value', 'darken', 'b'), edge('darken', 'value', 'darken-rgb', 'value'),
    edge('split', 'rgb', 'shade', 'a'), edge('darken-rgb', 'rgb', 'shade', 'b'), edge('shade', 'value', 'combine', 'rgb'),
    edge('split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')], layout: {
      ...row(['frame', 'split', 'shade', 'combine', 'output'], 0),
      ...row(['uv', 'uv-split', 'phase-y', 'density-phase', 'angle', 'wave', 'half-wave', 'scanline', 'inverse-scanline', 'attenuation', 'darken', 'darken-rgb'], 400),
      ...row(['time', 'speed', 'time-speed', 'point-one', 'scroll', 'density', 'hundred', 'half', 'one', 'opacity'], 800),
    } };
}

/** Exact legacy sine-dot grain with explicit deterministic time and seed phase. */
export function createDefaultGrainGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('split', 'vector.split.rgba'), node('uv', 'image.normalized-uv'), node('time', 'image.timeline-time'),
    node('size', 'values.number', { value: 'size' }), literal('hundred', 100), node('uv-scale', 'math.divide-ieee.scalar'), node('uv-scale2', 'convert.scalar-to-vec2'),
    node('grain-uv', 'math.multiply.vec2'), node('speed', 'values.number', { value: 'speed' }), node('scaled-time', 'math.multiply.scalar'),
    literal('point-one', 0.1), literal('point-zero-seven', 0.07), node('offset-x', 'math.multiply.scalar'), node('offset-y', 'math.multiply.scalar'),
    node('time-offset', 'vector.combine.vec2'), node('animated-uv', 'math.add.vec2'), literal('dot-x', 12.9898), literal('dot-y', 78.233),
    node('dot-vector', 'vector.combine.vec2'), node('dot', 'vector.dot.vec2'), node('seed', 'values.number', { value: 'seed' }), node('seeded-phase', 'math.add.scalar'),
    node('sine', 'math.sin.scalar'), literal('hash-scale', 43758.5453), node('scaled-sine', 'math.multiply.scalar'), node('unit-noise', 'math.fract.scalar'),
    literal('two', 2), node('double-noise', 'math.multiply.scalar'), literal('one', 1), node('signed-noise', 'math.subtract.scalar'),
    node('luma', 'color.luminance-rec709.rgb'), literal('half', 0.5), node('half-luma', 'math.multiply.scalar'), node('highlight-weight', 'math.subtract.scalar'),
    node('amount', 'values.number', { value: 'amount' }), node('intensity', 'math.multiply.scalar'), node('grain-value', 'math.multiply.scalar'),
    node('grain-rgb', 'convert.scalar-to-rgb'), node('grain-color', 'math.add.rgb'), literal('zero', 0), node('zero-rgb', 'convert.scalar-to-rgb'),
    node('one-rgb', 'convert.scalar-to-rgb'), node('clamp', 'math.clamp.rgb'), node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges: [
    edge('frame', 'image', 'split', 'image'), edge('hundred', 'value', 'uv-scale', 'a'), edge('size', 'value', 'uv-scale', 'b'),
    edge('uv-scale', 'value', 'uv-scale2', 'value'), edge('uv', 'uv', 'grain-uv', 'a'), edge('uv-scale2', 'value', 'grain-uv', 'b'),
    edge('time', 'value', 'scaled-time', 'a'), edge('speed', 'value', 'scaled-time', 'b'), edge('scaled-time', 'value', 'offset-x', 'a'),
    edge('point-one', 'value', 'offset-x', 'b'), edge('scaled-time', 'value', 'offset-y', 'a'), edge('point-zero-seven', 'value', 'offset-y', 'b'),
    edge('offset-x', 'value', 'time-offset', 'x'), edge('offset-y', 'value', 'time-offset', 'y'), edge('grain-uv', 'value', 'animated-uv', 'a'),
    edge('time-offset', 'value', 'animated-uv', 'b'), edge('dot-x', 'value', 'dot-vector', 'x'), edge('dot-y', 'value', 'dot-vector', 'y'),
    edge('animated-uv', 'value', 'dot', 'a'), edge('dot-vector', 'value', 'dot', 'b'), edge('dot', 'value', 'seeded-phase', 'a'), edge('seed', 'value', 'seeded-phase', 'b'),
    edge('seeded-phase', 'value', 'sine', 'value'), edge('sine', 'value', 'scaled-sine', 'a'), edge('hash-scale', 'value', 'scaled-sine', 'b'),
    edge('scaled-sine', 'value', 'unit-noise', 'value'), edge('unit-noise', 'value', 'double-noise', 'a'), edge('two', 'value', 'double-noise', 'b'),
    edge('double-noise', 'value', 'signed-noise', 'a'), edge('one', 'value', 'signed-noise', 'b'), edge('split', 'rgb', 'luma', 'rgb'),
    edge('luma', 'value', 'half-luma', 'a'), edge('half', 'value', 'half-luma', 'b'), edge('one', 'value', 'highlight-weight', 'a'), edge('half-luma', 'value', 'highlight-weight', 'b'),
    edge('amount', 'value', 'intensity', 'a'), edge('highlight-weight', 'value', 'intensity', 'b'), edge('signed-noise', 'value', 'grain-value', 'a'),
    edge('intensity', 'value', 'grain-value', 'b'), edge('grain-value', 'value', 'grain-rgb', 'value'), edge('split', 'rgb', 'grain-color', 'a'),
    edge('grain-rgb', 'rgb', 'grain-color', 'b'), edge('zero', 'value', 'zero-rgb', 'value'), edge('one', 'value', 'one-rgb', 'value'),
    edge('grain-color', 'value', 'clamp', 'value'), edge('zero-rgb', 'rgb', 'clamp', 'min'), edge('one-rgb', 'rgb', 'clamp', 'max'),
    edge('clamp', 'value', 'combine', 'rgb'), edge('split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')], layout: {
      ...row(['frame', 'split', 'grain-color', 'clamp', 'combine', 'output'], 0),
      ...row(['uv', 'grain-uv', 'animated-uv', 'dot', 'seeded-phase', 'sine', 'scaled-sine', 'unit-noise', 'double-noise', 'signed-noise'], 400),
      ...row(['time', 'speed', 'scaled-time', 'offset-x', 'offset-y', 'time-offset'], 800),
      ...row(['luma', 'half-luma', 'highlight-weight', 'intensity', 'grain-value', 'grain-rgb'], 1200),
      ...row(['size', 'hundred', 'uv-scale', 'uv-scale2', 'point-one', 'point-zero-seven', 'dot-x', 'dot-y', 'dot-vector'], 1600),
      ...row(['seed', 'hash-scale', 'two', 'one', 'half', 'amount', 'zero', 'zero-rgb', 'one-rgb'], 2000),
    } };
}

export function createDefaultContextualEffectGraph(type: EditableContextualEffectType): EffectOperatorGraph {
  if (type === 'vignette') return createDefaultVignetteGraph();
  if (type === 'scanlines') return createDefaultScanlinesGraph();
  if (type === 'grain') return createDefaultGrainGraph();
  throw new Error(`Unsupported contextual effect: ${String(type)}`);
}
