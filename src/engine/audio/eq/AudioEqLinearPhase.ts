import { getBiquadMagnitudeAtFrequency } from './AudioEqBiquad';
import { AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES, compileAudioEqPlan } from './AudioEqCompiler';
import { hasAudioEqDynamicBands } from './AudioEqDynamic';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import { fftRadix2 } from './AudioEqSpectralDynamics';
import { hasAudioEqSpectralDynamicsBands } from './AudioEqSpectralDynamics';
import type { AudioEqParamsV2, CompiledAudioEqPlan } from './AudioEqTypes';

export interface AudioEqLinearPhaseProcessResult {
  channels: Float32Array[];
  latencySamples: number;
}

function copyFloat32Array(input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  output.set(input);
  return output;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function nextPowerOfTwo(value: number): number {
  let output = 1;
  while (output < value) output <<= 1;
  return output;
}

function blackmanWindow(size: number): Float32Array {
  const output = new Float32Array(size);
  if (size <= 1) {
    output.fill(1);
    return output;
  }

  for (let index = 0; index < size; index += 1) {
    const phase = (2 * Math.PI * index) / (size - 1);
    output[index] = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
  }
  return output;
}

export function hasAudioEqLinearPhaseMode(params: AudioEqParamsV2 | unknown): boolean {
  const normalized = normalizeAudioEqParams(params);
  return normalized.audible.phaseMode === 'linear' &&
    !hasAudioEqDynamicBands(normalized) &&
    !hasAudioEqSpectralDynamicsBands(normalized);
}

function createLinearPhaseImpulse(plan: CompiledAudioEqPlan, fftSize: number): {
  impulse: Float32Array;
  latencySamples: number;
} {
  if (!isPowerOfTwo(fftSize) || fftSize < 1024) {
    throw new Error('Linear-phase EQ requires a power-of-two FFT size of at least 1024.');
  }

  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const half = fftSize / 2;

  for (let bin = 0; bin <= half; bin += 1) {
    const frequencyHz = (bin / fftSize) * plan.sampleRate;
    let magnitude = 1;
    for (const band of plan.bands) {
      for (const coefficients of band.coefficients) {
        magnitude *= getBiquadMagnitudeAtFrequency(coefficients, frequencyHz, plan.sampleRate);
      }
    }
    real[bin] = magnitude;
    if (bin > 0 && bin < half) {
      real[fftSize - bin] = magnitude;
    }
  }

  fftRadix2(real, imag, true);

  const impulseLength = Math.min(AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES * 2, half);
  const latencySamples = Math.floor(impulseLength / 2);
  const window = blackmanWindow(impulseLength);
  const impulse = new Float32Array(impulseLength);

  for (let index = 0; index < impulseLength; index += 1) {
    const circularIndex = (index - latencySamples + fftSize) % fftSize;
    impulse[index] = (real[circularIndex] ?? 0) * (window[index] ?? 0);
  }

  return { impulse, latencySamples };
}

function convolveLinearPhase(
  input: Float32Array,
  impulse: Float32Array,
  latencySamples: number,
): Float32Array {
  if (input.length === 0) return new Float32Array();

  const blockSize = 2048;
  const fftSize = nextPowerOfTwo(blockSize + impulse.length - 1);
  const impulseReal = new Float32Array(fftSize);
  const impulseImag = new Float32Array(fftSize);
  impulseReal.set(impulse);
  fftRadix2(impulseReal, impulseImag, false);

  const output = new Float32Array(input.length + impulse.length - 1);
  const blockReal = new Float32Array(fftSize);
  const blockImag = new Float32Array(fftSize);

  for (let offset = 0; offset < input.length; offset += blockSize) {
    blockReal.fill(0);
    blockImag.fill(0);
    const length = Math.min(blockSize, input.length - offset);
    for (let index = 0; index < length; index += 1) {
      blockReal[index] = input[offset + index] ?? 0;
    }

    fftRadix2(blockReal, blockImag, false);
    for (let bin = 0; bin < fftSize; bin += 1) {
      const real = blockReal[bin];
      const imag = blockImag[bin];
      const filterReal = impulseReal[bin];
      const filterImag = impulseImag[bin];
      blockReal[bin] = real * filterReal - imag * filterImag;
      blockImag[bin] = real * filterImag + imag * filterReal;
    }
    fftRadix2(blockReal, blockImag, true);

    const writeLength = Math.min(fftSize, output.length - offset);
    for (let index = 0; index < writeLength; index += 1) {
      output[offset + index] += blockReal[index] ?? 0;
    }
  }

  const compensated = new Float32Array(input.length);
  for (let index = 0; index < compensated.length; index += 1) {
    compensated[index] = output[index + latencySamples] ?? 0;
  }
  return compensated;
}

export function processAudioEqLinearPhaseChannels(
  channels: readonly Float32Array[],
  params: AudioEqParamsV2 | unknown,
  options: { sampleRate: number; fftSize?: number } = { sampleRate: 48_000 },
): AudioEqLinearPhaseProcessResult {
  if (!hasAudioEqLinearPhaseMode(params)) {
    return { channels: channels.map(copyFloat32Array), latencySamples: 0 };
  }

  const plan = compileAudioEqPlan(params, { sampleRate: options.sampleRate });
  if (plan.bands.length === 0) {
    return { channels: channels.map(copyFloat32Array), latencySamples: plan.latencySamples };
  }

  const fftSize = options.fftSize ?? 8192;
  const { impulse, latencySamples } = createLinearPhaseImpulse(plan, fftSize);
  return {
    channels: channels.map(channel => convolveLinearPhase(channel, impulse, latencySamples)),
    latencySamples,
  };
}
