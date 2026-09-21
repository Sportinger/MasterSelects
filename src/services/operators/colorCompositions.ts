import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';

const node = (id: string, operator: string): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {} });
const endpoint = (nodeId: string, portId: string): OperatorEndpoint => ({ nodeId, portId });
const port = (id: string, label: string, type: OperatorPort['type']): OperatorPort => ({ id, label, type, required: true });
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

const hueShiftGraph: EffectOperatorGraph = {
  version: 1,
  schemaVersion: 1,
  domain: 'image',
  nodes: [
    node('hsv', 'convert.rgb-to-hsv'),
    node('split-hsv', 'vector.split.vec3'),
    node('add-shift', 'math.add.scalar'),
    node('wrap-hue', 'math.fract.scalar'),
    node('combine-hsv', 'vector.combine.vec3'),
    node('rgb', 'convert.hsv-to-rgb'),
  ],
  edges: [
    edge('hsv', 'value', 'split-hsv', 'value'),
    edge('split-hsv', 'x', 'add-shift', 'a'),
    edge('add-shift', 'value', 'wrap-hue', 'value'),
    edge('wrap-hue', 'value', 'combine-hsv', 'x'),
    edge('split-hsv', 'y', 'combine-hsv', 'y'),
    edge('split-hsv', 'z', 'combine-hsv', 'z'),
    edge('combine-hsv', 'value', 'rgb', 'value'),
  ],
  layout: {
    hsv: { x: 0, y: 0 }, 'split-hsv': { x: 280, y: 0 }, 'add-shift': { x: 560, y: 0 },
    'wrap-hue': { x: 840, y: 0 }, 'combine-hsv': { x: 1120, y: 0 }, rgb: { x: 1400, y: 0 },
  },
};

/** Reusable HSV hue rotation assembled entirely from the existing image operators. */
export const COLOR_COMPOSITIONS: readonly OperatorDefinition[] = [{
  id: 'color.hue-shift.rgb',
  version: 1,
  label: 'Hue Shift',
  description: 'Rotate RGB hue in HSV space, wrap it in turns, and preserve saturation and value. Open to edit the conversion and math nodes.',
  inputs: [port('rgb', 'RGB', 'rgb'), port('shift', 'Shift (turns)', 'number')],
  outputs: [port('rgb', 'RGB', 'rgb')],
  parameters: [],
  runtime: 'builtin',
  invalidates: 'appearance',
  addable: true,
  state: 'stateless',
  fusion: 'inline',
  implementation: 'shared',
  consumers: ['Image graphs', 'Hue Shift'],
  composition: {
    graph: hueShiftGraph,
    inputs: { rgb: [endpoint('hsv', 'rgb')], shift: [endpoint('add-shift', 'b')] },
    outputs: { rgb: endpoint('rgb', 'rgb') },
  },
}];
