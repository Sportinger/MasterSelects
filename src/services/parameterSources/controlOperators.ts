import type { BoundOperatorNode, OperatorDefinition, OperatorParameter, OperatorPort } from '../../types/operatorGraph';
import { IMAGE_OPERATORS } from '../operators/imageOperators';

const port = (id: string): OperatorPort => ({ id, label: id, type: 'number' });
const number = (id: string, label: string, value: number, min = -10, max = 10): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step: 0.01 });
const source = (id: string, label: string, parameters: OperatorParameter[], inputs: string[] = []): OperatorDefinition => ({
  id, label, description: label, version: 1, runtime: 'builtin', invalidates: 'appearance', state: 'stateless',
  inputs: inputs.map(port), outputs: [port('value')], parameters, consumers: ['parameter-control'], implementation: 'shared',
});

/** Control-only additions plus the canonical scalar Math definitions. No GPU field evaluation. */
export const CONTROL_OPERATORS: readonly OperatorDefinition[] = [
  source('values.number', 'Constant', [number('value', 'Value', 0)]),
  source('control.time', 'Time', [{ id: 'basis', label: 'Time basis', type: 'select', default: 'clip',
    options: [{ value: 'clip', label: 'Clip time' }, { value: 'timeline', label: 'Timeline time' }] }]),
  source('control.lfo', 'LFO', [number('frequency', 'Frequency (Hz)', 1, 0, 10),
    number('amplitude', 'Amplitude', 1), number('offset', 'Offset', 0), number('phase', 'Phase (cycles)', 0, 0, 1)],
    ['time', 'frequency', 'amplitude', 'offset', 'phase']),
  source('control.keyframes', 'Keyframes', [{ id: 'property', label: 'Source curve', type: 'select', default: '', options: [] }]),
  ...IMAGE_OPERATORS.filter(def => ['math.add.scalar', 'math.multiply.scalar', 'math.clamp.scalar'].includes(def.id)),
  source('control.remap', 'Remap', [number('inMin', 'Input minimum', -1), number('inMax', 'Input maximum', 1),
    number('outMin', 'Output minimum', 0), number('outMax', 'Output maximum', 1)],
    ['value', 'inMin', 'inMax', 'outMin', 'outMax']),
];

export function getControlOperator(id: string): OperatorDefinition | undefined {
  return CONTROL_OPERATORS.find(definition => definition.id === id);
}

export function createControlNode(operator: string, id: string): BoundOperatorNode {
  const definition = getControlOperator(operator);
  if (!definition) throw new Error(`Unsupported control operator: ${operator}`);
  return { id, operator, operatorVersion: 1, bindings: {}, constants: {
    ...Object.fromEntries(definition.inputs.map(input => [input.id, input.id === 'max' || input.id === 'b' ? 1 : 0])),
    ...Object.fromEntries(definition.parameters.map(param => [param.id, param.default])),
    // An unwired LFO uses authored clip time, not a constant zero-time input.
    ...(operator === 'control.lfo' ? { time: 'clip' } : {}),
  } };
}
