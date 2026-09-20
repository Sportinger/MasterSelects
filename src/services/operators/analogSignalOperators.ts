import { ANALOG_SIGNAL_LAB_PARAMS, type AnalogSignalLabParameterId } from '../../effects/analog/signal-lab/parameters';
import type { OperatorDefinition, OperatorParameter, OperatorPort, OperatorSignal } from '../../types/operatorGraph';

const port = (id: string, label: string, type: OperatorSignal, required = false, formats?: string[]): OperatorPort =>
  ({ id, label, type, required, contract: formats ? { formats } : undefined });
const parameter = (id: AnalogSignalLabParameterId): OperatorParameter => {
  const spec = ANALOG_SIGNAL_LAB_PARAMS[id];
  if (spec.type !== 'number' && spec.type !== 'boolean' && spec.type !== 'select') throw new Error(`Unsupported Analog Signal parameter: ${id}`);
  return { id, label: spec.label, type: spec.type, default: spec.default, min: spec.min, max: spec.max,
    step: spec.step, animatable: spec.animatable, options: spec.options };
};
const parameters = (...ids: AnalogSignalLabParameterId[]) => [...new Set(ids)].map(parameter);
const PAL = ['pal-composite-864x313-rgba16f'];
const LINES = ['receiver-lines-313-rgba16f'];
const DECODED = ['analog-decoded-360x288-rgba16f'];
const operator = (id: string, label: string, inputs: OperatorPort[], outputs: OperatorPort[], ids: AnalogSignalLabParameterId[],
  bypass?: 'passthrough'): OperatorDefinition => ({ id, version: 1, label, description: `${label} stage of the existing Analog Signal Lab compute pipeline.`,
    inputs, outputs, parameters: parameters(...ids), invalidates: 'appearance', runtime: 'builtin', state: 'stateless', fusion: 'pass-boundary',
    family: id, consumers: ['analog-signal-lab'], implementation: 'local', addable: true, bypass });

const encode = ['palAmount', 'chromaLevel', 'palPhaseError', 'seed'] as AnalogSignalLabParameterId[];
const rf = ['rfAmount', 'signalStrength', 'rfNoise', 'impulseNoise', 'ghostLevel', 'ghostDelayUs', 'ghostPhase', 'multipathDrift', 'tuning', 'interference'] as AnalogSignalLabParameterId[];
const vhs = ['vhsAmount', 'tracking', 'dropout', 'timebaseError', 'tapeWear', 'chromaBleed', 'headSwitching', 'tapeSpeed'] as AnalogSignalLabParameterId[];
const receiver = ['receiverAmount', 'syncInstability', 'colorLock'] as AnalogSignalLabParameterId[];
const decode = ['lumaBandwidth', 'chromaBandwidth', 'ycCrosstalk', 'decoder'] as AnalogSignalLabParameterId[];
const display = ['amount', 'crtAmount', 'scanlines', 'maskStrength', 'bloom', 'curvature', 'flicker'] as AnalogSignalLabParameterId[];

export const ANALOG_SIGNAL_OPERATORS: readonly OperatorDefinition[] = [
  operator('analog.pal-encode', 'PAL Encode', [port('image', 'Image', 'image', true, ['decoded-frame'])], [port('signal', 'PAL Signal', 'pal-signal', false, PAL)], encode),
  operator('analog.rf-channel', 'RF Channel', [port('signal', 'Signal', 'pal-signal', true, PAL)], [port('signal', 'PAL Signal', 'pal-signal', false, PAL)], rf, 'passthrough'),
  operator('analog.vhs-transport', 'VHS Transport', [port('signal', 'Signal', 'pal-signal', true, PAL)], [port('signal', 'PAL Signal', 'pal-signal', false, PAL)], vhs, 'passthrough'),
  operator('analog.receiver-analyze', 'Receiver Analysis', [port('signal', 'Signal', 'pal-signal', true, PAL)], [port('lines', 'Receiver Lines', 'receiver-lines', false, LINES)], receiver),
  operator('analog.pal-decode', 'PAL Decode', [port('signal', 'Signal', 'pal-signal', true, PAL), port('receiver', 'Receiver Lines', 'receiver-lines', true, LINES)],
    [port('image', 'Decoded Image', 'image', false, DECODED)], decode),
  operator('analog.display-resolve', 'Display Resolve', [port('source', 'Original', 'image', true, ['decoded-frame']), port('decoded', 'Decoded', 'image', true, DECODED)],
    [port('image', 'Image', 'image', false, ['decoded-frame'])], display, 'passthrough'),
];
