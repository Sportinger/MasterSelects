import type { AudioDynamicsReductionSnapshot, AudioEffectInstance } from '../../../types';

export type AudioDynamicsEffectId =
  | 'audio-compressor'
  | 'audio-de-esser'
  | 'audio-limiter'
  | 'audio-noise-gate'
  | 'audio-expander';

export interface AudioDynamicsMarker {
  label: string;
  xPercent: number;
  yPercent: number;
}

export interface AudioDynamicsViewModel {
  effectId: AudioDynamicsEffectId;
  title: string;
  primary: string;
  secondary: string;
  points: string;
  markers: AudioDynamicsMarker[];
  liveGainReductionDb?: number;
}

const DYNAMICS_EFFECT_IDS = new Set<string>([
  'audio-compressor',
  'audio-de-esser',
  'audio-limiter',
  'audio-noise-gate',
  'audio-expander',
]);

const INPUT_MIN_DB = -80;
const INPUT_MAX_DB = 0;
const CURVE_STEPS = 28;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function readNumber(
  effect: AudioEffectInstance,
  paramName: string,
  fallback: number,
): number {
  const value = effect.params[paramName];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatDb(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} dB`;
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function normalizeDbToPercent(value: number): number {
  const clamped = clamp(value, INPUT_MIN_DB, INPUT_MAX_DB);
  return ((clamped - INPUT_MIN_DB) / (INPUT_MAX_DB - INPUT_MIN_DB)) * 100;
}

function outputDbToYPercent(value: number): number {
  return 100 - normalizeDbToPercent(value);
}

function createCurvePoints(mapOutputDb: (inputDb: number) => number): string {
  const points: string[] = [];
  for (let step = 0; step <= CURVE_STEPS; step += 1) {
    const xPercent = (step / CURVE_STEPS) * 100;
    const inputDb = INPUT_MIN_DB + (INPUT_MAX_DB - INPUT_MIN_DB) * (step / CURVE_STEPS);
    points.push(`${xPercent.toFixed(2)},${outputDbToYPercent(mapOutputDb(inputDb)).toFixed(2)}`);
  }
  return points.join(' ');
}

function marker(label: string, inputDb: number, outputDb: number): AudioDynamicsMarker {
  return {
    label,
    xPercent: normalizeDbToPercent(inputDb),
    yPercent: outputDbToYPercent(outputDb),
  };
}

function createCompressorViewModel(
  effect: AudioEffectInstance,
  title: string,
  effectId: AudioDynamicsEffectId,
): AudioDynamicsViewModel {
  const thresholdDb = clamp(readNumber(effect, 'thresholdDb', 0), INPUT_MIN_DB, INPUT_MAX_DB);
  const ratio = clamp(readNumber(effect, 'ratio', 1), 1, 20);
  const kneeDb = clamp(readNumber(effect, 'kneeDb', 0), 0, 40);
  const attackMs = clamp(readNumber(effect, 'attackMs', 10), 0.1, 500);
  const releaseMs = clamp(readNumber(effect, 'releaseMs', 120), 1, 2000);
  const makeupGainDb = clamp(readNumber(effect, 'makeupGainDb', 0), -24, 24);
  const outputForInput = (inputDb: number): number => {
    const kneeStart = thresholdDb - kneeDb / 2;
    const kneeEnd = thresholdDb + kneeDb / 2;
    if (kneeDb > 0 && inputDb > kneeStart && inputDb < kneeEnd) {
      const kneeMix = (inputDb - kneeStart) / Math.max(0.0001, kneeDb);
      const compressed = thresholdDb + (inputDb - thresholdDb) / ratio;
      return inputDb * (1 - kneeMix) + compressed * kneeMix + makeupGainDb;
    }
    if (inputDb <= thresholdDb) return inputDb + makeupGainDb;
    return thresholdDb + (inputDb - thresholdDb) / ratio + makeupGainDb;
  };

  return {
    effectId,
    title,
    primary: `${formatDb(thresholdDb)} / ${ratio.toFixed(1)}:1`,
    secondary: `A ${formatMs(attackMs)}  R ${formatMs(releaseMs)}`,
    points: createCurvePoints(outputForInput),
    markers: [
      marker('T', thresholdDb, outputForInput(thresholdDb)),
    ],
  };
}

function createLimiterViewModel(effect: AudioEffectInstance): AudioDynamicsViewModel {
  const ceilingDb = clamp(readNumber(effect, 'ceilingDb', 0), -24, 0);
  const inputGainDb = clamp(readNumber(effect, 'inputGainDb', 0), -24, 24);
  const outputForInput = (inputDb: number): number => Math.min(inputDb + inputGainDb, ceilingDb);

  return {
    effectId: 'audio-limiter',
    title: 'Limiter',
    primary: `${formatDb(ceilingDb)} ceiling`,
    secondary: `${formatDb(inputGainDb)} input`,
    points: createCurvePoints(outputForInput),
    markers: [
      marker('C', ceilingDb - inputGainDb, ceilingDb),
    ],
  };
}

function createNoiseGateViewModel(effect: AudioEffectInstance): AudioDynamicsViewModel {
  const thresholdDb = clamp(readNumber(effect, 'thresholdDb', -120), -120, 0);
  const floorDb = clamp(readNumber(effect, 'floorDb', -80), -100, 0);
  const attackMs = clamp(readNumber(effect, 'attackMs', 2), 0.1, 500);
  const releaseMs = clamp(readNumber(effect, 'releaseMs', 80), 1, 2000);
  const outputForInput = (inputDb: number): number => inputDb < thresholdDb ? floorDb : inputDb;

  return {
    effectId: 'audio-noise-gate',
    title: 'Gate',
    primary: `${formatDb(thresholdDb)} open`,
    secondary: `${formatDb(floorDb)} floor  A ${formatMs(attackMs)}  R ${formatMs(releaseMs)}`,
    points: createCurvePoints(outputForInput),
    markers: [
      marker('T', thresholdDb, outputForInput(thresholdDb)),
    ],
  };
}

function createExpanderViewModel(effect: AudioEffectInstance): AudioDynamicsViewModel {
  const thresholdDb = clamp(readNumber(effect, 'thresholdDb', 0), INPUT_MIN_DB, INPUT_MAX_DB);
  const ratio = clamp(readNumber(effect, 'ratio', 1), 1, 20);
  const rangeDb = clamp(readNumber(effect, 'rangeDb', 0), 0, 80);
  const attackMs = clamp(readNumber(effect, 'attackMs', 2), 0.1, 500);
  const releaseMs = clamp(readNumber(effect, 'releaseMs', 120), 1, 2000);
  const outputForInput = (inputDb: number): number => {
    if (inputDb >= thresholdDb || ratio <= 1.0001 || rangeDb <= 0.0001) return inputDb;
    const reductionDb = Math.min(rangeDb, (thresholdDb - inputDb) * (ratio - 1));
    return inputDb - reductionDb;
  };

  return {
    effectId: 'audio-expander',
    title: 'Expander',
    primary: `${formatDb(thresholdDb)} / ${ratio.toFixed(1)}:1`,
    secondary: `${formatDb(-rangeDb)} max  A ${formatMs(attackMs)}  R ${formatMs(releaseMs)}`,
    points: createCurvePoints(outputForInput),
    markers: [
      marker('T', thresholdDb, outputForInput(thresholdDb)),
    ],
  };
}

export function isAudioDynamicsEffect(effectId: string): effectId is AudioDynamicsEffectId {
  return DYNAMICS_EFFECT_IDS.has(effectId);
}

export function createAudioDynamicsViewModel(
  effect: AudioEffectInstance,
  title: string,
  runtime?: AudioDynamicsReductionSnapshot,
): AudioDynamicsViewModel | null {
  if (!isAudioDynamicsEffect(effect.descriptorId)) return null;

  const model = (() => {
    switch (effect.descriptorId) {
      case 'audio-compressor':
        return createCompressorViewModel(effect, title, 'audio-compressor');
      case 'audio-de-esser':
        return createCompressorViewModel(effect, title, 'audio-de-esser');
      case 'audio-limiter':
        return createLimiterViewModel(effect);
      case 'audio-noise-gate':
        return createNoiseGateViewModel(effect);
      case 'audio-expander':
        return createExpanderViewModel(effect);
    }
  })();

  if (!model || !runtime || runtime.effectId !== effect.id) return model;
  return {
    ...model,
    liveGainReductionDb: Math.max(0, Math.min(60, runtime.gainReductionDb)),
  };
}
