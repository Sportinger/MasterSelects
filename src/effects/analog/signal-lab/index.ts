import shader from './shader.wgsl?raw';
import type { ComputeEffectDefinition, EffectParam } from '../../types';

type Primitive = number | boolean | string;

function numberValue(values: Record<string, Primitive>, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mappedValue(
  values: Record<string, Primitive>,
  key: string,
  variants: Record<string, number>,
  fallback: string,
): number {
  const value = values[key];
  return variants[typeof value === 'string' ? value : fallback] ?? variants[fallback] ?? 0;
}

const params: Record<string, EffectParam> = {
  amount: {
    type: 'number', label: 'Mix', default: 1, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Signal',
  },
  palAmount: {
    type: 'number', label: 'PAL Stage', default: 1, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'PAL Encode / Decode',
  },
  lumaBandwidth: {
    type: 'number', label: 'Luma Bandwidth', default: 0.72, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'PAL Encode / Decode',
  },
  chromaBandwidth: {
    type: 'number', label: 'Chroma Bandwidth', default: 0.38, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'PAL Encode / Decode',
  },
  chromaLevel: {
    type: 'number', label: 'Chroma Level', default: 1, min: 0, max: 2, step: 0.01,
    animatable: true, group: 'PAL Encode / Decode',
  },
  ycCrosstalk: {
    type: 'number', label: 'Y/C Crosstalk', default: 0.18, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'PAL Encode / Decode',
  },
  palPhaseError: {
    type: 'number', label: 'PAL Phase Error', default: 0, min: -45, max: 45, step: 0.5,
    animatable: true, group: 'PAL Encode / Decode',
  },
  rfAmount: {
    type: 'number', label: 'RF / Antenna Stage', default: 1, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'RF Channel',
  },
  signalStrength: {
    type: 'number', label: 'Signal Strength', default: 0.82, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Reception',
  },
  rfNoise: {
    type: 'number', label: 'RF Noise', default: 0.22, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Reception',
  },
  impulseNoise: {
    type: 'number', label: 'Impulse Noise', default: 0.08, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Reception',
  },
  ghostLevel: {
    type: 'number', label: 'Ghost Level', default: 0.22, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Multipath',
  },
  ghostDelayUs: {
    type: 'number', label: 'Ghost Delay (us)', default: 1.8, min: 0.05, max: 12, step: 0.05,
    animatable: true, group: 'Multipath',
  },
  ghostPhase: {
    type: 'number', label: 'RF Phase', default: 25, min: -180, max: 180, step: 1,
    animatable: true, group: 'Multipath',
  },
  multipathDrift: {
    type: 'number', label: 'Path Drift', default: 0.12, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Multipath',
  },
  tuning: {
    type: 'number', label: 'Fine Tuning', default: 0, min: -1, max: 1, step: 0.01,
    animatable: true, group: 'Receiver',
  },
  interference: {
    type: 'number', label: 'Co-channel', default: 0.05, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Receiver',
  },
  syncInstability: {
    type: 'number', label: 'Sync Instability', default: 0.18, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Receiver',
  },
  colorLock: {
    type: 'number', label: 'Color Lock', default: 0.85, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Receiver',
  },
  receiverAmount: {
    type: 'number', label: 'Receiver Stage', default: 1, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Receiver',
  },
  decoder: {
    type: 'select', label: 'PAL Decoder', default: 'delay-line', group: 'Receiver',
    options: [
      { value: 'simple', label: 'Simple' },
      { value: 'delay-line', label: 'Delay Line' },
      { value: 'comb', label: 'Comb Filter' },
    ],
  },
  vhsAmount: {
    type: 'number', label: 'VHS Stage', default: 0, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  tracking: {
    type: 'number', label: 'Tracking Error', default: 0.12, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  dropout: {
    type: 'number', label: 'Dropouts', default: 0.06, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  timebaseError: {
    type: 'number', label: 'Time-base Error', default: 0.2, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  tapeWear: {
    type: 'number', label: 'Tape Wear', default: 0.08, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  chromaBleed: {
    type: 'number', label: 'Chroma Bleed', default: 0.3, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  headSwitching: {
    type: 'number', label: 'Head Switch', default: 0.45, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'VHS Transport',
  },
  tapeSpeed: {
    type: 'select', label: 'Tape Speed', default: 'sp', group: 'VHS Transport',
    options: [
      { value: 'sp', label: 'SP' },
      { value: 'lp', label: 'LP' },
      { value: 'ep', label: 'EP' },
    ],
  },
  crtAmount: {
    type: 'number', label: 'CRT Stage', default: 0.25, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'CRT Display',
  },
  scanlines: {
    type: 'number', label: 'Scanlines', default: 0.22, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'CRT Display',
  },
  maskStrength: {
    type: 'number', label: 'Phosphor Mask', default: 0.12, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'CRT Display',
  },
  bloom: {
    type: 'number', label: 'Bloom', default: 0.16, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'CRT Display',
  },
  curvature: {
    type: 'number', label: 'Curvature', default: 0.08, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'CRT Display',
  },
  flicker: {
    type: 'number', label: 'Field Flicker', default: 0.06, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'CRT Display',
  },
  seed: {
    type: 'number', label: 'Channel Seed', default: 1, min: 0, max: 9999, step: 1,
    animatable: false, group: 'Signal',
  },
};

export const analogSignalLab: ComputeEffectDefinition = {
  pipelineKind: 'compute',
  computeMode: 'analog-signal',
  id: 'analog-signal-lab',
  name: 'Analog Signal Lab',
  category: 'analog',
  shader,
  entryPoint: 'analogResolveCompute',
  uniformSize: 160,
  workgroupSize: [8, 8],
  requiresContinuousRender: false,
  params,
  packUniforms: (values, width, height, timelineTimeSeconds = 0) => new Float32Array([
    width,
    height,
    Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
    numberValue(values, 'seed', 1),
    numberValue(values, 'amount', 1),
    numberValue(values, 'signalStrength', 0.82),
    numberValue(values, 'rfNoise', 0.22),
    numberValue(values, 'impulseNoise', 0.08),
    numberValue(values, 'ghostLevel', 0.22),
    numberValue(values, 'ghostDelayUs', 1.8),
    numberValue(values, 'ghostPhase', 25),
    numberValue(values, 'multipathDrift', 0.12),
    numberValue(values, 'tuning', 0),
    numberValue(values, 'interference', 0.05),
    numberValue(values, 'syncInstability', 0.18),
    numberValue(values, 'colorLock', 0.85),
    numberValue(values, 'vhsAmount', 0),
    numberValue(values, 'tracking', 0.12),
    numberValue(values, 'dropout', 0.06),
    numberValue(values, 'timebaseError', 0.2),
    numberValue(values, 'tapeWear', 0.08),
    numberValue(values, 'chromaBleed', 0.3),
    numberValue(values, 'headSwitching', 0.45),
    mappedValue(values, 'tapeSpeed', { sp: 0, lp: 1, ep: 2 }, 'sp'),
    numberValue(values, 'crtAmount', 0.25),
    numberValue(values, 'scanlines', 0.22),
    numberValue(values, 'maskStrength', 0.12),
    numberValue(values, 'bloom', 0.16),
    numberValue(values, 'curvature', 0.08),
    numberValue(values, 'flicker', 0.06),
    mappedValue(values, 'decoder', { simple: 0, 'delay-line': 1, comb: 2 }, 'delay-line'),
    0,
    numberValue(values, 'palAmount', 1),
    numberValue(values, 'lumaBandwidth', 0.72),
    numberValue(values, 'chromaBandwidth', 0.38),
    numberValue(values, 'chromaLevel', 1),
    numberValue(values, 'ycCrosstalk', 0.18),
    numberValue(values, 'palPhaseError', 0),
    numberValue(values, 'rfAmount', 1),
    numberValue(values, 'receiverAmount', 1),
  ]),
};
