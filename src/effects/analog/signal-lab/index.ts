import shader from './shader.wgsl?raw';
import type { ComputeEffectDefinition } from '../../types';
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

export const analogSignalLab: ComputeEffectDefinition = {
  pipelineKind: 'compute', computeMode: 'analog-signal', id: 'analog-signal-lab', name: 'Analog Signal Lab', category: 'analog',
  shader, entryPoint: 'analogResolveCompute', uniformSize: 160, workgroupSize: [8, 8], requiresContinuousRender: false,
  params: ANALOG_SIGNAL_LAB_PARAMS,
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
