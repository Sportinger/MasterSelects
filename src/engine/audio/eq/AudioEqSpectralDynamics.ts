import { normalizeAudioEqParams } from './AudioEqLegacy';
import type {
  AudioEqBand,
  AudioEqBandSpectralDynamics,
  AudioEqParamsV2,
} from './AudioEqTypes';

const MIN_MAGNITUDE = 1e-8;

export interface AudioEqSpectralDynamicsBandTelemetry {
  bandId: string;
  maxGainReductionDb: number;
  maxExpansionDb: number;
  lastMagnitudeDb: number;
  lastSpectralGainDb: number;
}

export interface AudioEqSpectralDynamicsProcessResult {
  channels: Float32Array[];
  telemetry: AudioEqSpectralDynamicsBandTelemetry[];
}

export interface AudioEqSpectralDynamicsBandRange {
  minHz: number;
  maxHz: number;
  centerHz: number;
}

interface SpectralBandPlan {
  band: AudioEqBand;
  settings: AudioEqBandSpectralDynamics;
  fftSize: number;
  hopSize: number;
  minBin: number;
  maxBin: number;
  weights: Float32Array;
  gainDbByChannel: Float32Array[];
  attackCoefficient: number;
  releaseCoefficient: number;
  telemetry: AudioEqSpectralDynamicsBandTelemetry;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function dbToLinearGain(db: number): number {
  return Math.pow(10, db / 20);
}

function linearToDb(value: number): number {
  return 20 * Math.log10(Math.max(MIN_MAGNITUDE, value));
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function copyFloat32Array(input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  output.set(input);
  return output;
}

function timeCoefficient(milliseconds: number, hopSize: number, sampleRate: number): number {
  const seconds = Math.max(0.0001, milliseconds / 1000);
  return Math.exp(-hopSize / Math.max(1, seconds * sampleRate));
}

function isSpectralDynamicsBand(band: AudioEqBand): boolean {
  return band.enabled !== false &&
    band.stereoMode === 'stereo' &&
    band.spectralDynamics?.enabled === true &&
    band.type !== 'all-pass';
}

export function hasAudioEqSpectralDynamicsBands(params: AudioEqParamsV2 | unknown): boolean {
  return normalizeAudioEqParams(params).audible.bands.some(isSpectralDynamicsBand);
}

export function chooseAudioEqSpectralDynamicsFftSize(
  resolution: AudioEqBandSpectralDynamics['resolution'],
): number {
  switch (resolution) {
    case 'low-latency':
      return 1024;
    case 'mastering':
      return 4096;
    case 'balanced':
    default:
      return 2048;
  }
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window.fill(1);
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

export function fftRadix2(real: Float32Array, imag: Float32Array, inverse = false): void {
  const n = real.length;
  if (n !== imag.length || !isPowerOfTwo(n)) {
    throw new Error('FFT buffers must be equal power-of-two lengths.');
  }

  let j = 0;
  for (let i = 1; i < n - 1; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const realSwap = real[i];
      real[i] = real[j];
      real[j] = realSwap;
      const imagSwap = imag[i];
      imag[i] = imag[j];
      imag[j] = imagSwap;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const phaseStepReal = Math.cos(angle);
    const phaseStepImag = Math.sin(angle);

    for (let offset = 0; offset < n; offset += size) {
      let phaseReal = 1;
      let phaseImag = 0;
      for (let index = 0; index < half; index += 1) {
        const evenIndex = offset + index;
        const oddIndex = evenIndex + half;
        const oddReal = real[oddIndex] * phaseReal - imag[oddIndex] * phaseImag;
        const oddImag = real[oddIndex] * phaseImag + imag[oddIndex] * phaseReal;
        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextPhaseReal = phaseReal * phaseStepReal - phaseImag * phaseStepImag;
        phaseImag = phaseReal * phaseStepImag + phaseImag * phaseStepReal;
        phaseReal = nextPhaseReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < n; index += 1) {
      real[index] /= n;
      imag[index] /= n;
    }
  }
}

export function getAudioEqSpectralDynamicsBandRange(
  band: AudioEqBand,
  sampleRate: number,
): AudioEqSpectralDynamicsBandRange {
  const nyquist = Math.max(20, sampleRate / 2);
  const centerHz = clamp(band.frequencyHz, 1, nyquist);
  const q = clamp(band.q, 0.025, 100);

  if (band.type === 'low-shelf' || band.type === 'low-cut') {
    return {
      minHz: 0,
      maxHz: clamp(centerHz * Math.max(1.15, 1.7 / Math.sqrt(q)), 20, nyquist),
      centerHz,
    };
  }

  if (band.type === 'high-shelf' || band.type === 'high-cut') {
    return {
      minHz: clamp(centerHz / Math.max(1.15, 1.7 / Math.sqrt(q)), 0, nyquist),
      maxHz: nyquist,
      centerHz,
    };
  }

  if (band.type === 'tilt-shelf') {
    const octaveWidth = clamp(3 / q, 0.18, 4);
    const minHz = centerHz / Math.pow(2, octaveWidth / 2);
    const maxHz = centerHz * Math.pow(2, octaveWidth / 2);
    return {
      minHz: clamp(minHz, 0, nyquist),
      maxHz: clamp(maxHz, 20, nyquist),
      centerHz,
    };
  }

  const bandwidthHz = Math.max(12, centerHz / q);
  return {
    minHz: clamp(centerHz - bandwidthHz / 2, 0, nyquist),
    maxHz: clamp(centerHz + bandwidthHz / 2, 20, nyquist),
    centerHz,
  };
}

export function calculateAudioEqSpectralDynamicsGainDb(
  settings: AudioEqBandSpectralDynamics,
  magnitudeDb: number,
): number {
  if (!settings.enabled || magnitudeDb <= settings.thresholdDb) {
    return 0;
  }

  const ratio = Math.max(1, settings.ratio);
  const overThresholdDb = magnitudeDb - settings.thresholdDb;
  const ratioAmountDb = overThresholdDb * (1 - 1 / ratio);
  const amountDb = Math.max(0, Math.min(settings.rangeDb, ratioAmountDb));
  return settings.mode === 'expand' ? amountDb : -amountDb;
}

function createSpectralBandPlan(
  band: AudioEqBand,
  channelCount: number,
  sampleRate: number,
): SpectralBandPlan | null {
  const settings = band.spectralDynamics;
  if (!settings?.enabled) return null;

  const fftSize = chooseAudioEqSpectralDynamicsFftSize(settings.resolution);
  const hopSize = Math.max(1, Math.floor(fftSize / 4));
  const nyquist = sampleRate / 2;
  const binHz = sampleRate / fftSize;
  const range = getAudioEqSpectralDynamicsBandRange(band, sampleRate);
  const widthHz = Math.max(binHz, range.maxHz - range.minHz);
  const featherHz = Math.max(binHz * 1.5, widthHz * 0.2);
  const minBin = Math.max(1, Math.floor(Math.max(0, range.minHz - featherHz) / binHz));
  const maxBin = Math.min(
    Math.floor(fftSize / 2) - 1,
    Math.ceil(Math.min(nyquist, range.maxHz + featherHz) / binHz),
  );

  if (maxBin < minBin) {
    return null;
  }

  const weights = new Float32Array(maxBin - minBin + 1);
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const frequencyHz = bin * binHz;
    let weight = 1;
    if (frequencyHz < range.minHz) {
      weight = featherHz <= 0 ? 0 : (frequencyHz - (range.minHz - featherHz)) / featherHz;
    } else if (frequencyHz > range.maxHz) {
      weight = featherHz <= 0 ? 0 : ((range.maxHz + featherHz) - frequencyHz) / featherHz;
    }
    weights[bin - minBin] = clamp(weight, 0, 1);
  }

  return {
    band,
    settings,
    fftSize,
    hopSize,
    minBin,
    maxBin,
    weights,
    gainDbByChannel: Array.from(
      { length: channelCount },
      () => new Float32Array(Math.floor(fftSize / 2) + 1),
    ),
    attackCoefficient: timeCoefficient(settings.attackMs, hopSize, sampleRate),
    releaseCoefficient: timeCoefficient(settings.releaseMs, hopSize, sampleRate),
    telemetry: {
      bandId: band.id,
      maxGainReductionDb: 0,
      maxExpansionDb: 0,
      lastMagnitudeDb: -160,
      lastSpectralGainDb: 0,
    },
  };
}

function groupPlansByFftSize(plans: readonly SpectralBandPlan[]): SpectralBandPlan[][] {
  const groups = new Map<number, SpectralBandPlan[]>();
  for (const plan of plans) {
    const group = groups.get(plan.fftSize) ?? [];
    group.push(plan);
    groups.set(plan.fftSize, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group);
}

function processChannelGroup(
  input: Float32Array,
  plans: readonly SpectralBandPlan[],
  channelIndex: number,
): Float32Array {
  const firstPlan = plans[0];
  if (!firstPlan || input.length === 0) {
    return copyFloat32Array(input);
  }

  const fftSize = firstPlan.fftSize;
  const hopSize = firstPlan.hopSize;
  const window = hannWindow(fftSize);
  const windowSum = window.reduce((sum, value) => sum + value, 0);
  const output = new Float32Array(input.length);
  const normalization = new Float32Array(input.length);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const frameStartOffset = -Math.floor(fftSize / 2);
  const frameCount = Math.max(1, Math.ceil((input.length - frameStartOffset) / hopSize));

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = frameStartOffset + frameIndex * hopSize;
    real.fill(0);
    imag.fill(0);

    for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
      const sourceIndex = frameStart + sampleOffset;
      real[sampleOffset] = sourceIndex >= 0 && sourceIndex < input.length
        ? (input[sourceIndex] ?? 0) * (window[sampleOffset] ?? 0)
        : 0;
    }

    fftRadix2(real, imag, false);

    for (const plan of plans) {
      const gainsDb = plan.gainDbByChannel[channelIndex];
      if (!gainsDb) continue;

      for (let bin = plan.minBin; bin <= plan.maxBin; bin += 1) {
        const weight = plan.weights[bin - plan.minBin] ?? 0;
        if (weight <= 0) continue;

        const mirrorBin = fftSize - bin;
        const magnitude = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
        const magnitudeDb = linearToDb((magnitude * 2) / Math.max(MIN_MAGNITUDE, windowSum));
        const targetGainDb = calculateAudioEqSpectralDynamicsGainDb(plan.settings, magnitudeDb) * weight;
        const previousGainDb = gainsDb[bin] ?? 0;
        const coefficient = Math.abs(targetGainDb) > Math.abs(previousGainDb)
          ? plan.attackCoefficient
          : plan.releaseCoefficient;
        const nextGainDb = targetGainDb + coefficient * (previousGainDb - targetGainDb);
        const gain = dbToLinearGain(nextGainDb);

        gainsDb[bin] = nextGainDb;
        real[bin] *= gain;
        imag[bin] *= gain;
        real[mirrorBin] *= gain;
        imag[mirrorBin] *= gain;

        plan.telemetry.lastMagnitudeDb = magnitudeDb;
        plan.telemetry.lastSpectralGainDb = nextGainDb;
        plan.telemetry.maxGainReductionDb = Math.max(
          plan.telemetry.maxGainReductionDb,
          Math.max(0, -nextGainDb),
        );
        plan.telemetry.maxExpansionDb = Math.max(
          plan.telemetry.maxExpansionDb,
          Math.max(0, nextGainDb),
        );
      }
    }

    fftRadix2(real, imag, true);

    for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
      const targetIndex = frameStart + sampleOffset;
      if (targetIndex < 0 || targetIndex >= input.length) continue;
      const windowValue = window[sampleOffset] ?? 0;
      output[targetIndex] += real[sampleOffset] * windowValue;
      normalization[targetIndex] += windowValue * windowValue;
    }
  }

  for (let index = 0; index < input.length; index += 1) {
    const normalizer = normalization[index] ?? 0;
    output[index] = normalizer > MIN_MAGNITUDE ? output[index] / normalizer : input[index] ?? 0;
  }

  return output;
}

export function processAudioEqSpectralDynamicsChannels(
  channels: readonly Float32Array[],
  params: AudioEqParamsV2 | unknown,
  options: { sampleRate: number },
): AudioEqSpectralDynamicsProcessResult {
  const normalized = normalizeAudioEqParams(params);
  const sampleRate = Math.max(1, options.sampleRate);
  const plans = normalized.audible.bands
    .filter(isSpectralDynamicsBand)
    .map(band => createSpectralBandPlan(band, channels.length, sampleRate))
    .filter((plan): plan is SpectralBandPlan => Boolean(plan));

  if (plans.length === 0) {
    return {
      channels: channels.map(copyFloat32Array),
      telemetry: [],
    };
  }

  const planGroups = groupPlansByFftSize(plans);
  const outputChannels = channels.map((channel, channelIndex) => {
    let processed = copyFloat32Array(channel);
    for (const group of planGroups) {
      processed = processChannelGroup(processed, group, channelIndex);
    }
    return processed;
  });

  return {
    channels: outputChannels,
    telemetry: plans.map(plan => ({ ...plan.telemetry })),
  };
}
