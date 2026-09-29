import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../../types/operatorGraph';

/**
 * General per-element field nodes. An unconnected Position reads the element being evaluated
 * (the curve point here); other unconnected inputs use the node's parameter. They lower to the
 * shared pointwise table, so every per-element executor evaluates them identically.
 */
const port = (id: string, label: string, type: OperatorPort['type'], required = false): OperatorPort => ({ id, label, type, required });
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.001, animatable = true): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable });
const field = (id: string, label: string, description: string, inputs: OperatorPort[], parameters: OperatorParameter[]): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs: [port('value', 'Value', 'number')], parameters,
    invalidates: 'appearance', runtime: 'builtin', state: 'stateless', fusion: 'inline', addable: true, implementation: 'shared', consumers: ['Weave'] });

export const FIELD_OPERATORS: readonly OperatorDefinition[] = [
  field('field.shape-distance', 'Shape Distance', 'Signed distance from each element to a sphere, cube or horizontal plane: negative inside, positive outside.',
    [port('position', 'Position', 'vec3'), port('center', 'Center', 'vec3'), port('size', 'Size', 'number')],
    [{ id: 'shape', label: 'Shape', type: 'select', default: 'sphere', options: [
      { value: 'sphere', label: 'Sphere' }, { value: 'box', label: 'Cube' }, { value: 'plane', label: 'Plane' }] },
    { id: 'center', label: 'Center', type: 'vector', default: [0, 0, 0], animatable: true }, number('size', 'Size', 0.5, 0, 100)]),
  field('field.noise', 'Noise', 'Smooth fractal value noise at each element position, between -Amplitude and +Amplitude; Seed picks an independent pattern.',
    [port('position', 'Position', 'vec3'), port('frequency', 'Frequency', 'number'), port('amplitude', 'Amplitude', 'number')],
    [number('frequency', 'Frequency', 2, 0, 1000, 0.01), number('amplitude', 'Amplitude', 1, -100, 100, 0.01),
      number('octaves', 'Octaves', 3, 1, 6, 1, false), number('seed', 'Seed', 0, 0, 9999, 1, false)]),
  field('field.ramp', 'Ramp', 'Maps a value through a smooth curve with three keys; values beyond the first or last key hold that key.',
    [port('value', 'Value', 'number', true)],
    [number('x0', 'Key 1 In', -0.1, -100, 100), number('y0', 'Key 1 Out', 1, -100, 100), number('x1', 'Key 2 In', 0, -100, 100),
      number('y1', 'Key 2 Out', 1, -100, 100), number('x2', 'Key 3 In', 0.1, -100, 100), number('y2', 'Key 3 Out', 0, -100, 100)]),
];
