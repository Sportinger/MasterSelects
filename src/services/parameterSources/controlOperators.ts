import type { BoundOperatorNode, OperatorDefinition, OperatorParameter, OperatorPort } from '../../types/operatorGraph';
import { IMAGE_OPERATORS } from '../operators/imageOperators';

const port = (id: string, label = id): OperatorPort => ({ id, label, type: 'number' });
const number = (id: string, label: string, value: number, min = -10, max = 10, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step });
const select = (id: string, label: string, value: string, options: ReadonlyArray<readonly [string, string]>): OperatorParameter =>
  ({ id, label, type: 'select', default: value, options: options.map(([option, text]) => ({ value: option, label: text })) });
const source = (id: string, label: string, parameters: OperatorParameter[], inputs: string[] = [],
  outputs: OperatorPort[] = [port('value')]): OperatorDefinition => ({
  id, label, description: label, version: 1, runtime: 'builtin', invalidates: 'appearance', state: 'stateless',
  inputs: inputs.map(input => port(input)), outputs, parameters, consumers: ['parameter-control'], implementation: 'shared',
});

/** Control-only additions plus the canonical scalar Math definitions. No GPU field evaluation. */
export const CONTROL_OPERATORS: readonly OperatorDefinition[] = [
  source('values.number', 'Value', [number('value', 'Value', 0)]),
  source('control.time', 'Time', [{ id: 'basis', label: 'Time basis', type: 'select', default: 'clip',
    options: [{ value: 'clip', label: 'Clip time' }, { value: 'timeline', label: 'Timeline time' }] }]),
  source('control.lfo', 'Oscillator', [number('frequency', 'Frequency (Hz)', 1, 0, 10),
    number('amplitude', 'Amplitude', 1), number('offset', 'Offset', 0), number('phase', 'Phase (cycles)', 0, 0, 1)],
    ['time', 'frequency', 'amplitude', 'offset', 'phase']),
  source('control.noise', 'Smooth Noise', [number('frequency', 'Frequency (Hz)', 2, 0, 30),
    number('amplitude', 'Amplitude', 1), number('offset', 'Offset', 0), number('seed', 'Seed', 0, 0, 1000, 1),
    number('octaves', 'Detail', 1, 1, 4, 1)],
    ['time', 'frequency', 'amplitude', 'offset', 'seed']),
  source('control.envelope', 'Envelope', [number('attack', 'Attack (s)', 0, 0, 5), number('hold', 'Hold (s)', 0, 0, 5),
    number('decay', 'Decay (s)', 0.3, 0, 10), number('amplitude', 'Amplitude', 1),
    select('curve', 'Decay curve', 'exponential', [['exponential', 'Exponential'], ['linear', 'Linear']])],
    ['age', 'attack', 'hold', 'decay', 'amplitude']),
  source('control.marker-trigger', 'Marker Trigger', [{ id: 'label', label: 'Marker', type: 'select', default: '', options: [] },
    select('mode', 'Output', 'since', [['since', 'Seconds since marker'], ['until', 'Seconds until next marker'],
      ['count', 'Markers passed'], ['progress', 'Progress to next marker']])], ['time']),
  source('control.ik-two-bone', 'Two-Bone IK', [number('rootX', 'Root X', 0), number('rootY', 'Root Y', 0),
    number('targetX', 'Target X', 0.5), number('targetY', 'Target Y', 0),
    number('length1', 'Upper length', 0.3, 0, 10), number('length2', 'Lower length', 0.3, 0, 10),
    select('bend', 'Bend', 'positive', [['positive', 'Positive rotation'], ['negative', 'Negative rotation']]),
    number('aspect', 'X scale', 1, 0.01, 10)],
    ['rootX', 'rootY', 'targetX', 'targetY', 'length1', 'length2'],
    [port('angle1', 'Upper angle'), port('angle2', 'Lower angle'), port('jointX', 'Joint X'), port('jointY', 'Joint Y'),
      port('endX', 'End X'), port('endY', 'End Y'), port('reach', 'Reach')]),
  source('control.keyframes', 'Keyframes', [{ id: 'property', label: 'Source curve', type: 'select', default: '', options: [] }]),
  source('control.audio-envelope', 'Audio Envelope', [
    { id: 'audioClipId', label: 'Audio source', type: 'select', default: '', options: [] },
    { id: 'basis', label: 'Time basis', type: 'select', default: 'timeline', options: [
      { value: 'timeline', label: 'Timeline seconds' }, { value: 'source', label: 'Source seconds' }] },
    { id: 'metric', label: 'Level', type: 'select', default: 'rms-dbfs', options: [
      { value: 'rms-dbfs', label: 'RMS (dBFS)' }, { value: 'momentary-lufs', label: 'Momentary loudness' },
      { value: 'short-term-lufs', label: 'Short-term loudness' }] },
    { id: 'interpolation', label: 'Interpolation', type: 'select', default: 'linear', options: [
      { value: 'linear', label: 'Linear' }, { value: 'nearest', label: 'Nearest' }] },
    number('floorDb', 'Silence level (dB)', -60, -120, 0), number('ceilingDb', 'Full level (dB)', 0, -60, 12),
  ], ['time']),
  ...IMAGE_OPERATORS.filter(def => ['math.add.scalar', 'math.multiply.scalar', 'math.clamp.scalar'].includes(def.id)),
  source('control.remap', 'Remap', [number('inMin', 'Input minimum', -1), number('inMax', 'Input maximum', 1),
    number('outMin', 'Output minimum', 0), number('outMax', 'Output maximum', 1)],
    ['value', 'inMin', 'inMax', 'outMin', 'outMax']),
];

/** Unwired clock inputs follow an authored clock instead of a constant zero. */
const CLOCK_INPUTS: Readonly<Record<string, Readonly<Record<string, 'clip' | 'timeline'>>>> = {
  'control.lfo': { time: 'clip' },
  'control.noise': { time: 'clip' },
  'control.envelope': { age: 'clip' },
  'control.marker-trigger': { time: 'timeline' },
  'control.audio-envelope': { time: 'timeline' },
};
export const controlClockInputs = (operator: string) => CLOCK_INPUTS[operator] ?? {};

export function getControlOperator(id: string): OperatorDefinition | undefined {
  return CONTROL_OPERATORS.find(definition => definition.id === id);
}

export function createControlNode(operator: string, id: string): BoundOperatorNode {
  const definition = getControlOperator(operator);
  if (!definition) throw new Error(`Unsupported control operator: ${operator}`);
  return { id, operator, operatorVersion: 1, bindings: {}, constants: {
    ...Object.fromEntries(definition.inputs.map(input => [input.id, input.id === 'max' || input.id === 'b' ? 1 : 0])),
    ...Object.fromEntries(definition.parameters.map(param => [param.id, param.default])),
    ...controlClockInputs(operator),
  } };
}
