import type { EffectParam } from '../../types';

const number = (label: string, fallback: number, min: number, max: number, group: string, step = 0.01,
  animatable = true): EffectParam => ({ type: 'number', label, default: fallback, min, max, step, animatable, group });
const select = (label: string, fallback: string, group: string, options: { value: string; label: string }[]): EffectParam =>
  ({ type: 'select', label, default: fallback, group, options });

/** Single parameter source shared by the legacy compute effect and its editable operator graph. */
export const ANALOG_SIGNAL_LAB_PARAMS = {
  amount: number('Mix', 1, 0, 1, 'Signal'),
  palAmount: number('PAL Stage', 1, 0, 1, 'PAL Encode / Decode'),
  lumaBandwidth: number('Luma Bandwidth', 0.72, 0, 1, 'PAL Encode / Decode'),
  chromaBandwidth: number('Chroma Bandwidth', 0.38, 0, 1, 'PAL Encode / Decode'),
  chromaLevel: number('Chroma Level', 1, 0, 2, 'PAL Encode / Decode'),
  ycCrosstalk: number('Y/C Crosstalk', 0.18, 0, 1, 'PAL Encode / Decode'),
  palPhaseError: number('PAL Phase Error', 0, -45, 45, 'PAL Encode / Decode', 0.5),
  rfAmount: number('RF / Antenna Stage', 1, 0, 1, 'RF Channel'),
  signalStrength: number('Signal Strength', 0.82, 0, 1, 'Reception'),
  rfNoise: number('RF Noise', 0.22, 0, 1, 'Reception'),
  impulseNoise: number('Impulse Noise', 0.08, 0, 1, 'Reception'),
  ghostLevel: number('Ghost Level', 0.22, 0, 1, 'Multipath'),
  ghostDelayUs: number('Ghost Delay (us)', 1.8, 0.05, 12, 'Multipath', 0.05),
  ghostPhase: number('RF Phase', 25, -180, 180, 'Multipath', 1),
  multipathDrift: number('Path Drift', 0.12, 0, 1, 'Multipath'),
  tuning: number('Fine Tuning', 0, -1, 1, 'Receiver'),
  interference: number('Co-channel', 0.05, 0, 1, 'Receiver'),
  syncInstability: number('Sync Instability', 0.18, 0, 1, 'Receiver'),
  colorLock: number('Color Lock', 0.85, 0, 1, 'Receiver'),
  receiverAmount: number('Receiver Stage', 1, 0, 1, 'Receiver'),
  decoder: select('PAL Decoder', 'delay-line', 'Receiver', [
    { value: 'simple', label: 'Simple' }, { value: 'delay-line', label: 'Delay Line' }, { value: 'comb', label: 'Comb Filter' },
  ]),
  vhsAmount: number('VHS Stage', 0, 0, 1, 'VHS Transport'),
  tracking: number('Tracking Error', 0.12, 0, 1, 'VHS Transport'),
  dropout: number('Dropouts', 0.06, 0, 1, 'VHS Transport'),
  timebaseError: number('Time-base Error', 0.2, 0, 1, 'VHS Transport'),
  tapeWear: number('Tape Wear', 0.08, 0, 1, 'VHS Transport'),
  chromaBleed: number('Chroma Bleed', 0.3, 0, 1, 'VHS Transport'),
  headSwitching: number('Head Switch', 0.45, 0, 1, 'VHS Transport'),
  tapeSpeed: select('Tape Speed', 'sp', 'VHS Transport', [
    { value: 'sp', label: 'SP' }, { value: 'lp', label: 'LP' }, { value: 'ep', label: 'EP' },
  ]),
  crtAmount: number('CRT Stage', 0.25, 0, 1, 'CRT Display'),
  scanlines: number('Scanlines', 0.22, 0, 1, 'CRT Display'),
  maskStrength: number('Phosphor Mask', 0.12, 0, 1, 'CRT Display'),
  bloom: number('Bloom', 0.16, 0, 1, 'CRT Display'),
  curvature: number('Curvature', 0.08, 0, 1, 'CRT Display'),
  flicker: number('Field Flicker', 0.06, 0, 1, 'CRT Display'),
  seed: number('Channel Seed', 1, 0, 9999, 'Signal', 1, false),
} satisfies Record<string, EffectParam>;

export type AnalogSignalLabParameterId = keyof typeof ANALOG_SIGNAL_LAB_PARAMS;
