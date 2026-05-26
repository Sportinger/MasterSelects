import { getBiquadMagnitudeAtFrequency } from './AudioEqBiquad';
import { compileAudioEqPlan } from './AudioEqCompiler';
import type { AudioEqParamsV2, CompiledAudioEqBandPlan, CompiledAudioEqPlan } from './AudioEqTypes';

export const AUDIO_EQ_MIN_FREQUENCY_HZ = 20;
export const AUDIO_EQ_MAX_FREQUENCY_HZ = 20_000;

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-12, gain));
}

export function createLogFrequencySamples(
  count = 512,
  minFrequencyHz = AUDIO_EQ_MIN_FREQUENCY_HZ,
  maxFrequencyHz = AUDIO_EQ_MAX_FREQUENCY_HZ,
): Float32Array {
  const sampleCount = Math.max(2, Math.round(count));
  const output = new Float32Array(sampleCount);
  const minLog = Math.log10(minFrequencyHz);
  const maxLog = Math.log10(maxFrequencyHz);

  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / (sampleCount - 1);
    output[index] = Math.pow(10, minLog + (maxLog - minLog) * t);
  }

  return output;
}

export function sampleCompiledEqBandResponseDb(
  bandPlan: CompiledAudioEqBandPlan,
  frequenciesHz: Float32Array,
  sampleRate: number,
): Float32Array {
  const output = new Float32Array(frequenciesHz.length);
  if (!bandPlan.band.enabled) {
    return output;
  }

  for (let index = 0; index < frequenciesHz.length; index += 1) {
    let magnitude = 1;
    for (const coefficients of bandPlan.coefficients) {
      magnitude *= getBiquadMagnitudeAtFrequency(coefficients, frequenciesHz[index], sampleRate);
    }
    output[index] = gainToDb(magnitude);
  }

  return output;
}

export function sumBandResponsesDb(responses: readonly Float32Array[]): Float32Array {
  const length = responses[0]?.length ?? 0;
  const output = new Float32Array(length);

  for (const response of responses) {
    for (let index = 0; index < length; index += 1) {
      output[index] += response[index] ?? 0;
    }
  }

  return output;
}

export interface AudioEqResponseSet {
  frequenciesHz: Float32Array;
  bandResponsesDb: Map<string, Float32Array>;
  summedResponseDb: Float32Array;
  plan: CompiledAudioEqPlan;
}

export function createAudioEqResponseSet(
  params: AudioEqParamsV2 | unknown,
  options: {
    sampleRate?: number;
    sampleCount?: number;
    minFrequencyHz?: number;
    maxFrequencyHz?: number;
  } = {},
): AudioEqResponseSet {
  const plan = compileAudioEqPlan(params, { sampleRate: options.sampleRate });
  const frequenciesHz = createLogFrequencySamples(
    options.sampleCount ?? 512,
    options.minFrequencyHz ?? AUDIO_EQ_MIN_FREQUENCY_HZ,
    options.maxFrequencyHz ?? AUDIO_EQ_MAX_FREQUENCY_HZ,
  );
  const bandResponsesDb = new Map<string, Float32Array>();

  for (const band of plan.bands) {
    bandResponsesDb.set(band.band.id, sampleCompiledEqBandResponseDb(band, frequenciesHz, plan.sampleRate));
  }

  const summedResponseDb = sumBandResponsesDb([...bandResponsesDb.values()]);
  return { frequenciesHz, bandResponsesDb, summedResponseDb, plan };
}
