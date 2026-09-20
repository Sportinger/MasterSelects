import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableColorEffectType = 'brightness' | 'contrast' | 'saturation' | 'exposure' | 'levels' | 'hue-shift' | 'temperature' | 'vibrance';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

function base(nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph {
  const ordered = [node('frame', 'image.frame'), node('split', 'vector.split.rgba'), ...nodes,
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: ordered,
    edges: [edge('frame', 'image', 'split', 'image'), ...edges, edge('split', 'alpha', 'combine', 'alpha'),
      edge('combine', 'image', 'output', 'image')],
    layout: Object.fromEntries(ordered.map((item, index) => [item.id, { x: index * 260, y: item.id === 'split' || item.id === 'combine' ? 0 : 180 }])) };
}
const scalar = (id: string, value: number) => [node(id, 'values.number', {}, { value }), node(`${id}-rgb`, 'convert.scalar-to-rgb')] as const;
const scalarEdges = (id: string) => edge(id, 'value', `${id}-rgb`, 'value');
const clampTail = (source: string) => [
  edge(source, 'value', 'clamp', 'value'), edge('zero-rgb', 'rgb', 'clamp', 'min'), edge('one-rgb', 'rgb', 'clamp', 'max'),
  edge('clamp', 'value', 'combine', 'rgb'),
];

export function createDefaultBrightnessGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), node('amount-rgb', 'convert.scalar-to-rgb'), ...zero, ...one,
    node('add', 'math.add.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('amount', 'value', 'amount-rgb', 'value'), scalarEdges('zero'), scalarEdges('one'), edge('split', 'rgb', 'add', 'a'),
    edge('amount-rgb', 'rgb', 'add', 'b'), ...clampTail('add'),
  ]);
}

export function createDefaultContrastGraph(): EffectOperatorGraph {
  const half = scalar('half', 0.5), zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), node('amount-rgb', 'convert.scalar-to-rgb'), ...half, ...zero, ...one,
    node('subtract-half', 'math.subtract.rgb'), node('multiply', 'math.multiply.rgb'), node('add-half', 'math.add.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('amount', 'value', 'amount-rgb', 'value'), scalarEdges('half'), scalarEdges('zero'), scalarEdges('one'),
    edge('split', 'rgb', 'subtract-half', 'a'), edge('half-rgb', 'rgb', 'subtract-half', 'b'),
    edge('subtract-half', 'value', 'multiply', 'a'), edge('amount-rgb', 'rgb', 'multiply', 'b'),
    edge('multiply', 'value', 'add-half', 'a'), edge('half-rgb', 'rgb', 'add-half', 'b'), ...clampTail('add-half'),
  ]);
}

export function createDefaultSaturationGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), ...zero, ...one, node('luma', 'color.luminance-rec601.rgb'),
    node('luma-rgb', 'convert.scalar-to-rgb'), node('mix', 'math.mix.rgb'), node('clamp', 'math.clamp.rgb')], [
    scalarEdges('zero'), scalarEdges('one'), edge('split', 'rgb', 'luma', 'rgb'), edge('luma', 'value', 'luma-rgb', 'value'),
    edge('luma-rgb', 'rgb', 'mix', 'a'), edge('split', 'rgb', 'mix', 'b'), edge('amount', 'value', 'mix', 't'), ...clampTail('mix'),
  ]);
}

export function createDefaultExposureGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('exposure', 'values.number', { value: 'exposure' }), node('gain', 'math.exp2.scalar'), node('gain-rgb', 'convert.scalar-to-rgb'),
    node('offset', 'values.number', { value: 'offset' }), node('offset-rgb', 'convert.scalar-to-rgb'), node('gamma', 'values.number', { value: 'gamma' }),
    node('inverse-gamma', 'math.reciprocal.scalar'), node('inverse-gamma-rgb', 'convert.scalar-to-rgb'), ...zero, ...one,
    node('multiply-gain', 'math.multiply.rgb'), node('add-offset', 'math.add.rgb'), node('nonnegative', 'math.max.rgb'),
    node('power', 'math.power.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('exposure', 'value', 'gain', 'value'), edge('gain', 'value', 'gain-rgb', 'value'), edge('offset', 'value', 'offset-rgb', 'value'),
    edge('gamma', 'value', 'inverse-gamma', 'value'), edge('inverse-gamma', 'value', 'inverse-gamma-rgb', 'value'), scalarEdges('zero'), scalarEdges('one'),
    edge('split', 'rgb', 'multiply-gain', 'a'), edge('gain-rgb', 'rgb', 'multiply-gain', 'b'), edge('multiply-gain', 'value', 'add-offset', 'a'),
    edge('offset-rgb', 'rgb', 'add-offset', 'b'), edge('add-offset', 'value', 'nonnegative', 'a'), edge('zero-rgb', 'rgb', 'nonnegative', 'b'),
    edge('nonnegative', 'value', 'power', 'a'), edge('inverse-gamma-rgb', 'rgb', 'power', 'b'), ...clampTail('power'),
  ]);
}

export function createDefaultLevelsGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  const boundRgb = (id: string) => [node(id, 'values.number', { value: id }), node(`${id}-rgb`, 'convert.scalar-to-rgb')] as const;
  return base([...boundRgb('inputBlack'), node('inputWhite', 'values.number', { value: 'inputWhite' }), node('gamma', 'values.number', { value: 'gamma' }),
    ...boundRgb('outputBlack'), ...boundRgb('outputWhite'), ...zero, ...one,
    node('input-range', 'math.subtract.scalar'), node('input-range-rgb', 'convert.scalar-to-rgb'), node('subtract-black', 'math.subtract.rgb'),
    node('normalize', 'math.divide-ieee.rgb'), node('clamp-input', 'math.clamp.rgb'), node('inverse-gamma', 'math.reciprocal.scalar'),
    node('inverse-gamma-rgb', 'convert.scalar-to-rgb'), node('power', 'math.power.rgb'), node('output-mix', 'math.mix-components.rgb')], [
    scalarEdges('inputBlack'), scalarEdges('outputBlack'), scalarEdges('outputWhite'), scalarEdges('zero'), scalarEdges('one'),
    edge('inputWhite', 'value', 'input-range', 'a'), edge('inputBlack', 'value', 'input-range', 'b'), edge('input-range', 'value', 'input-range-rgb', 'value'),
    edge('split', 'rgb', 'subtract-black', 'a'), edge('inputBlack-rgb', 'rgb', 'subtract-black', 'b'), edge('subtract-black', 'value', 'normalize', 'a'),
    edge('input-range-rgb', 'rgb', 'normalize', 'b'), edge('normalize', 'value', 'clamp-input', 'value'), edge('zero-rgb', 'rgb', 'clamp-input', 'min'),
    edge('one-rgb', 'rgb', 'clamp-input', 'max'), edge('gamma', 'value', 'inverse-gamma', 'value'), edge('inverse-gamma', 'value', 'inverse-gamma-rgb', 'value'),
    edge('clamp-input', 'value', 'power', 'a'), edge('inverse-gamma-rgb', 'rgb', 'power', 'b'), edge('outputBlack-rgb', 'rgb', 'output-mix', 'a'),
    edge('outputWhite-rgb', 'rgb', 'output-mix', 'b'), edge('power', 'value', 'output-mix', 't'), edge('output-mix', 'value', 'combine', 'rgb'),
  ]);
}

export function createDefaultHueShiftGraph(): EffectOperatorGraph {
  return base([node('hsv', 'convert.rgb-to-hsv'), node('split-hsv', 'vector.split.vec3'), node('shift', 'values.number', { value: 'shift' }),
    node('add-shift', 'math.add.scalar'), node('wrap-hue', 'math.fract.scalar'), node('combine-hsv', 'vector.combine.vec3'), node('rgb', 'convert.hsv-to-rgb')], [
    edge('split', 'rgb', 'hsv', 'rgb'), edge('hsv', 'value', 'split-hsv', 'value'), edge('split-hsv', 'x', 'add-shift', 'a'),
    edge('shift', 'value', 'add-shift', 'b'), edge('add-shift', 'value', 'wrap-hue', 'value'), edge('wrap-hue', 'value', 'combine-hsv', 'x'),
    edge('split-hsv', 'y', 'combine-hsv', 'y'), edge('split-hsv', 'z', 'combine-hsv', 'z'), edge('combine-hsv', 'value', 'rgb', 'value'),
    edge('rgb', 'rgb', 'combine', 'rgb'),
  ]);
}

export function createDefaultTemperatureGraph(): EffectOperatorGraph {
  const constant = (id: string, value: number) => node(id, 'values.number', {}, { value });
  return base([node('temperature', 'values.number', { value: 'temperature' }), node('tint', 'values.number', { value: 'tint' }),
    constant('positive-tenth', 0.1), constant('negative-tenth', -0.1), constant('half-tenth', 0.05),
    node('temp-r', 'math.multiply.scalar'), node('tint-offset', 'math.multiply.scalar'), node('red-offset', 'math.add.scalar'),
    node('green-offset', 'math.multiply.scalar'), node('temp-b', 'math.multiply.scalar'),
    node('blue-offset', 'math.add.scalar'), node('offset-vector', 'vector.combine.vec3'), node('offset-rgb', 'convert.vec3-to-rgb'),
    ...scalar('zero', 0), ...scalar('one', 1), node('add-offset', 'math.add.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('temperature', 'value', 'temp-r', 'a'), edge('positive-tenth', 'value', 'temp-r', 'b'), edge('tint', 'value', 'tint-offset', 'a'),
    edge('half-tenth', 'value', 'tint-offset', 'b'), edge('temp-r', 'value', 'red-offset', 'a'), edge('tint-offset', 'value', 'red-offset', 'b'),
    edge('tint', 'value', 'green-offset', 'a'), edge('negative-tenth', 'value', 'green-offset', 'b'), edge('temperature', 'value', 'temp-b', 'a'),
    edge('negative-tenth', 'value', 'temp-b', 'b'), edge('temp-b', 'value', 'blue-offset', 'a'), edge('tint-offset', 'value', 'blue-offset', 'b'),
    edge('red-offset', 'value', 'offset-vector', 'x'),
    edge('green-offset', 'value', 'offset-vector', 'y'), edge('blue-offset', 'value', 'offset-vector', 'z'), edge('offset-vector', 'value', 'offset-rgb', 'value'),
    scalarEdges('zero'), scalarEdges('one'), edge('split', 'rgb', 'add-offset', 'a'), edge('offset-rgb', 'rgb', 'add-offset', 'b'), ...clampTail('add-offset'),
  ]);
}

export function createDefaultVibranceGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), node('max-channel', 'vector.reduce-max.rgb'), node('min-channel', 'vector.reduce-min.rgb'),
    node('range', 'math.subtract.scalar'), node('epsilon', 'values.number', {}, { value: 0.001 }), node('denominator', 'math.add.scalar'),
    node('saturation', 'math.divide-ieee.scalar'), node('one-minus-saturation', 'math.subtract.scalar'), node('vibrance', 'math.multiply.scalar'),
    node('mix-factor', 'math.add.scalar'), node('luma', 'color.luminance-rec601.rgb'), node('luma-rgb', 'convert.scalar-to-rgb'),
    ...zero, ...one, node('mix', 'math.mix.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('split', 'rgb', 'max-channel', 'rgb'), edge('split', 'rgb', 'min-channel', 'rgb'), edge('max-channel', 'value', 'range', 'a'),
    edge('min-channel', 'value', 'range', 'b'), edge('max-channel', 'value', 'denominator', 'a'), edge('epsilon', 'value', 'denominator', 'b'),
    edge('range', 'value', 'saturation', 'a'), edge('denominator', 'value', 'saturation', 'b'), edge('one', 'value', 'one-minus-saturation', 'a'),
    edge('saturation', 'value', 'one-minus-saturation', 'b'), edge('amount', 'value', 'vibrance', 'a'), edge('one-minus-saturation', 'value', 'vibrance', 'b'),
    edge('one', 'value', 'mix-factor', 'a'), edge('vibrance', 'value', 'mix-factor', 'b'), edge('split', 'rgb', 'luma', 'rgb'),
    edge('luma', 'value', 'luma-rgb', 'value'), scalarEdges('zero'), scalarEdges('one'), edge('luma-rgb', 'rgb', 'mix', 'a'),
    edge('split', 'rgb', 'mix', 'b'), edge('mix-factor', 'value', 'mix', 't'), ...clampTail('mix'),
  ]);
}

export function createDefaultColorEffectGraph(type: EditableColorEffectType): EffectOperatorGraph {
  return type === 'brightness' ? createDefaultBrightnessGraph()
    : type === 'contrast' ? createDefaultContrastGraph() : type === 'saturation' ? createDefaultSaturationGraph()
      : type === 'exposure' ? createDefaultExposureGraph() : type === 'levels' ? createDefaultLevelsGraph()
        : type === 'hue-shift' ? createDefaultHueShiftGraph() : type === 'temperature' ? createDefaultTemperatureGraph()
          : createDefaultVibranceGraph();
}
