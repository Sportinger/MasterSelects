import type { BoundOperatorNode, OperatorDefinition, OperatorParameter, OperatorPort } from '../../types/operatorGraph';
import { IMAGE_OPERATORS } from '../operators/imageOperators';
import { SKELETON_JOINT_LABELS, SKELETON_JOINTS } from '../rig/skeletonRig';

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

/** Gait outputs share ids with the Stick Figure joint parameters, so they connect one to one. */
const GAIT_ANGLE_PORTS: OperatorPort[] = [['spine', 'Spine'], ['head', 'Head'], ['shoulderL', 'Shoulder L'], ['elbowL', 'Elbow L'],
  ['shoulderR', 'Shoulder R'], ['elbowR', 'Elbow R'], ['hipL', 'Hip L'], ['kneeL', 'Knee L'], ['hipR', 'Hip R'], ['kneeR', 'Knee R']]
  .map(([id, label]) => port(id, label));
export const GAIT_ANGLE_OUTPUTS: readonly string[] = GAIT_ANGLE_PORTS.map(output => output.id);

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
  source('control.ballistic', 'Ballistic', [number('launch', 'Launch (s)', 0, 0, 600), number('startX', 'Start X', 0),
    number('startY', 'Start Y', 0), number('velocityX', 'Velocity X', 0.5), number('velocityY', 'Velocity Y', -2),
    number('gravity', 'Gravity', 6, -100, 100), select('floor', 'Floor', 'on', [['on', 'Bounce on floor'], ['off', 'No floor']]),
    number('floorY', 'Floor Y', 0.8), number('bounce', 'Bounce', 0.45, 0, 1), number('slide', 'Slide', 0.85, 0, 1)],
    ['time', 'launch', 'startX', 'startY', 'velocityX', 'velocityY', 'gravity', 'floorY', 'bounce', 'slide'],
    [port('x', 'X'), port('y', 'Y'), port('vx', 'Velocity X'), port('vy', 'Velocity Y'), port('bounces', 'Bounces'),
      port('resting', 'Resting')]),
  source('rig.gait-cycle', 'Gait Cycle', [select('gait', 'Gait', 'walk', [['walk', 'Walk'], ['run', 'Run'], ['idle', 'Idle']]),
    number('speed', 'Cycles per second', 1, 0, 10), number('stride', 'Stride', 1, 0, 3), number('lean', 'Lean (deg)', 0, -90, 90),
    number('phase', 'Phase (cycles)', 0, 0, 1)],
    ['time', 'speed', 'stride', 'lean', 'phase'],
    [...GAIT_ANGLE_PORTS, port('bounce', 'Bounce (px)'), port('contactL', 'Foot L down'), port('contactR', 'Foot R down')]),
  source('rig.limb-ik', 'Limb IK', [{ id: 'figure', label: 'Stick figure', type: 'select', default: '', options: [] },
    select('limb', 'Limb', 'legL', [['legL', 'Leg L'], ['legR', 'Leg R'], ['armL', 'Arm L'], ['armR', 'Arm R']]),
    number('targetX', 'Target X (px)', 20, -1000, 1000, 1), number('targetY', 'Target Y (px)', 130, -1000, 1000, 1),
    select('bend', 'Bend', 'natural', [['natural', 'Natural (knee forward, elbow back)'], ['reverse', 'Reverse']])],
    ['targetX', 'targetY'],
    [port('upper', 'Hip / Shoulder'), port('lower', 'Knee / Elbow'), port('reach', 'Reach')]),
  source('rig.attach', 'Attach to Joint', [{ id: 'figure', label: 'Stick figure', type: 'select', default: '', options: [] },
    select('joint', 'Joint', 'handR', SKELETON_JOINTS.map(joint => [joint, SKELETON_JOINT_LABELS[joint]] as const)),
    number('grab', 'Grab (s)', 0, 0, 600), number('blend', 'Blend (s)', 0.15, 0, 10),
    number('release', 'Release (s, -1 = hold)', -1, -1, 600),
    number('restX', 'Rest X', 0), number('restY', 'Rest Y', 0), number('restRotation', 'Rest rotation', 0, -360, 360, 0.1),
    number('spin', 'Spin after release (deg/s)', 0, -3600, 3600, 1),
    number('gravity', 'Gravity', 6, -100, 100), select('floor', 'Floor', 'on', [['on', 'Bounce on floor'], ['off', 'No floor']]),
    number('floorY', 'Floor Y', 0.8), number('bounce', 'Bounce', 0.45, 0, 1), number('slide', 'Slide', 0.85, 0, 1)],
    ['time', 'grab', 'blend', 'release', 'restX', 'restY', 'restRotation', 'spin', 'gravity', 'floorY', 'bounce', 'slide'],
    [port('x', 'X'), port('y', 'Y'), port('rotation', 'Rotation'), port('attached', 'Attached')]),
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
  'control.ballistic': { time: 'clip' },
  'rig.gait-cycle': { time: 'clip' },
  'rig.attach': { time: 'clip' },
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
