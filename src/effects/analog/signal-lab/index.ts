import shader from './shader.wgsl?raw';
import type { ComputeEffectDefinition, EffectPreset } from '../../types';
import { ANALOG_SIGNAL_LAB_PARAMS } from './parameters';

type Primitive = number | boolean | string;
function numberValue(values: Record<string, Primitive>, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function mappedValue(values: Record<string, Primitive>, key: string, variants: Record<string, number>, fallback: string): number {
  const value = values[key];
  return variants[typeof value === 'string' ? value : fallback] ?? variants[fallback] ?? 0;
}

/** Parameters the signal model clamps to their declared range (shader.wgsl); the others are used as given. */
export const ANALOG_SIGNAL_CLAMPED_PARAMS: ReadonlySet<string> = new Set(['amount', 'palAmount', 'lumaBandwidth', 'chromaBandwidth', 'chromaLevel', 'ycCrosstalk', 'rfAmount', 'signalStrength',
  'colorLock', 'receiverAmount', 'vhsAmount', 'crtAmount']);
const format = (value: number) => Number(value.toPrecision(4)).toString();

/** Values outside a control's range (keyframes and tools do not clamp): say what the signal model does with them. */
function analogSignalParamWarnings(values: Record<string, Primitive>): string[] {
  return Object.entries(ANALOG_SIGNAL_LAB_PARAMS).flatMap(([id, definition]) => {
    const value = values[id];
    if (definition.type !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) return [];
    const min = definition.min ?? -Infinity, max = definition.max ?? Infinity;
    if (value >= min && value <= max) return [];
    return ANALOG_SIGNAL_CLAMPED_PARAMS.has(id)
      ? [`${definition.label} ${format(value)} is outside ${format(min)} to ${format(max)} and renders as ${format(Math.min(max, Math.max(min, value)))}.`]
      : [`${definition.label} ${format(value)} is outside ${format(min)} to ${format(max)}; the signal model uses it as given, which can look extreme.`];
  });
}

/** One point on each part of the chain: the antenna, the tape, the tube and a signal that is lost. */
const ANALOG_SIGNAL_LAB_PRESETS: EffectPreset[] = [
  { id: 'snowy-reception', name: 'Snowy Reception', params: { signalStrength: 0.35, rfNoise: 0.55, impulseNoise: 0.2, ghostLevel: 0.45,
    ghostDelayUs: 3.5, multipathDrift: 0.3, syncInstability: 0.3, colorLock: 0.65, crtAmount: 0.35 } },
  { id: 'worn-vhs', name: 'Worn VHS', params: { rfAmount: 0, vhsAmount: 1, tapeSpeed: 'lp', tracking: 0.3, dropout: 0.15, tapeWear: 0.25,
    chromaBleed: 0.6, headSwitching: 0.7, crtAmount: 0.2 } },
  { id: 'tube-television', name: 'Tube Television', params: { signalStrength: 0.95, rfNoise: 0.08, ghostLevel: 0.06, crtAmount: 1,
    scanlines: 0.6, maskStrength: 0.5, bloom: 0.4, curvature: 0.45, flicker: 0.15 } },
  { id: 'rolling-picture', name: 'Rolling Picture', params: { signalStrength: 0.25, rfNoise: 0.45, impulseNoise: 0.2, tuning: 0.3,
    interference: 0.3, syncInstability: 0.85, colorLock: 0.3, crtAmount: 0.35 } },
];

export const analogSignalLab: ComputeEffectDefinition = {
  pipelineKind: 'compute', computeMode: 'analog-signal', id: 'analog-signal-lab', name: 'Analog Signal Lab', category: 'analog',
  shader, entryPoint: 'analogResolveCompute', uniformSize: 160, workgroupSize: [8, 8], requiresContinuousRender: false,
  // Its noise, rolling and tape faults move with the timeline clock and hold still while paused.
  timelineAnimated: true,
  params: ANALOG_SIGNAL_LAB_PARAMS,
  presets: ANALOG_SIGNAL_LAB_PRESETS,
  paramWarnings: analogSignalParamWarnings,
  packUniforms: (values, width, height, timelineTimeSeconds = 0) => new Float32Array([
    width, height, Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
    numberValue(values, 'seed', 1), numberValue(values, 'amount', 1), numberValue(values, 'signalStrength', 0.82),
    numberValue(values, 'rfNoise', 0.22), numberValue(values, 'impulseNoise', 0.08), numberValue(values, 'ghostLevel', 0.22),
    numberValue(values, 'ghostDelayUs', 1.8), numberValue(values, 'ghostPhase', 25), numberValue(values, 'multipathDrift', 0.12),
    numberValue(values, 'tuning', 0), numberValue(values, 'interference', 0.05), numberValue(values, 'syncInstability', 0.18),
    numberValue(values, 'colorLock', 0.85), numberValue(values, 'vhsAmount', 0), numberValue(values, 'tracking', 0.12),
    numberValue(values, 'dropout', 0.06), numberValue(values, 'timebaseError', 0.2), numberValue(values, 'tapeWear', 0.08),
    numberValue(values, 'chromaBleed', 0.3), numberValue(values, 'headSwitching', 0.45),
    mappedValue(values, 'tapeSpeed', { sp: 0, lp: 1, ep: 2 }, 'sp'), numberValue(values, 'crtAmount', 0.25),
    numberValue(values, 'scanlines', 0.22), numberValue(values, 'maskStrength', 0.12), numberValue(values, 'bloom', 0.16),
    numberValue(values, 'curvature', 0.08), numberValue(values, 'flicker', 0.06),
    mappedValue(values, 'decoder', { simple: 0, 'delay-line': 1, comb: 2 }, 'delay-line'), 0,
    numberValue(values, 'palAmount', 1), numberValue(values, 'lumaBandwidth', 0.72), numberValue(values, 'chromaBandwidth', 0.38),
    numberValue(values, 'chromaLevel', 1), numberValue(values, 'ycCrosstalk', 0.18), numberValue(values, 'palPhaseError', 0),
    numberValue(values, 'rfAmount', 1), numberValue(values, 'receiverAmount', 1),
  ]),
};
