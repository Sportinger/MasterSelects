import {
  type FrequencyAccumulator,
  type FrequencyAnalysis,
  type FrequencyBandDefinition,
  type FrequencyPhaseAnalysisContext,
  type NormalizedFrequencyBand,
  type NormalizedFrequencyPhaseParameters,
} from './frequencyPhaseAnalysisTypes';
import {
  EPSILON,
  clamp,
  createMonoMix,
  fftRadix2,
  hannWindow,
  powerToDb,
} from './frequencyPhaseMath';

const DEFAULT_FREQUENCY_BANDS: readonly FrequencyBandDefinition[] = [
  { bandId: 'sub', label: 'Sub', minFrequency: 20, maxFrequency: 60, group: 'low' },
  { bandId: 'bass', label: 'Bass', minFrequency: 60, maxFrequency: 250, group: 'low' },
  { bandId: 'low-mid', label: 'Low Mid', minFrequency: 250, maxFrequency: 500, group: 'mid' },
  { bandId: 'mid', label: 'Mid', minFrequency: 500, maxFrequency: 2000, group: 'mid' },
  { bandId: 'high-mid', label: 'High Mid', minFrequency: 2000, maxFrequency: 4000, group: 'mid' },
  { bandId: 'presence', label: 'Presence', minFrequency: 4000, maxFrequency: 6000, group: 'high' },
  { bandId: 'brilliance', label: 'Brilliance', minFrequency: 6000, maxFrequency: 20000, group: 'high' },
];

function normalizeBands(sampleRate: number, fftSize: number): NormalizedFrequencyBand[] {
  const nyquist = sampleRate / 2;
  const binCount = fftSize / 2;

  return DEFAULT_FREQUENCY_BANDS.map((band) => {
    const clampedMin = clamp(band.minFrequency, 0, nyquist);
    const clampedMax = clamp(band.maxFrequency, clampedMin, nyquist);
    const binStart = Math.max(1, Math.floor((clampedMin / sampleRate) * fftSize));
    const binEnd = Math.max(binStart + 1, Math.min(binCount, Math.ceil((clampedMax / sampleRate) * fftSize)));
    return {
      ...band,
      maxFrequency: clampedMax,
      binStart,
      binEnd,
      binCount: Math.max(0, binEnd - binStart),
    };
  });
}

export function analyzeFrequencySummary(
  buffer: AudioBuffer,
  parameters: NormalizedFrequencyPhaseParameters,
  context: FrequencyPhaseAnalysisContext,
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void,
): FrequencyAnalysis {
  const mix = createMonoMix(buffer);
  const window = hannWindow(parameters.fftSize);
  const real = new Float32Array(parameters.fftSize);
  const imag = new Float32Array(parameters.fftSize);
  const bands = normalizeBands(buffer.sampleRate, parameters.fftSize);
  const accumulators: FrequencyAccumulator[] = bands.map((band) => ({
    ...band,
    energy: 0,
    peakPower: 0,
    weightedFrequency: 0,
  }));

  let totalEnergy = 0;
  let totalWeightedFrequency = 0;
  const binCount = parameters.fftSize / 2;

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    if (frameIndex % 64 === 0) {
      context.onProgress?.({
        jobId: context.jobId,
        mediaFileId: context.mediaFileId,
        sourceFingerprint: context.sourceFingerprint,
        frequencyCacheKey: context.frequencyCacheKey,
        phaseCacheKey: context.phaseCacheKey,
        phase: 'analyzing-frequency',
        percent: 5 + (frameIndex / parameters.frameCount) * 45,
        timestamp: new Date().toISOString(),
        frameIndex,
        frameCount: parameters.frameCount,
        message: 'Analyzing frequency bands',
      });
    }
    throwIfCancelled(context.signal, context.jobId);

    real.fill(0);
    imag.fill(0);
    const sampleStart = frameIndex * parameters.hopSize;
    for (let sampleOffset = 0; sampleOffset < parameters.fftSize; sampleOffset += 1) {
      real[sampleOffset] = (mix[sampleStart + sampleOffset] ?? 0) * (window[sampleOffset] ?? 1);
    }

    fftRadix2(real, imag);

    for (let binIndex = 1; binIndex < binCount; binIndex += 1) {
      const power = (real[binIndex] * real[binIndex] + imag[binIndex] * imag[binIndex]) /
        (parameters.fftSize * parameters.fftSize);
      if (!Number.isFinite(power) || power <= 0) {
        continue;
      }

      const frequency = (binIndex * buffer.sampleRate) / parameters.fftSize;
      totalEnergy += power;
      totalWeightedFrequency += power * frequency;

      for (const accumulator of accumulators) {
        if (binIndex < accumulator.binStart || binIndex >= accumulator.binEnd) {
          continue;
        }
        accumulator.energy += power;
        accumulator.peakPower = Math.max(accumulator.peakPower, power);
        accumulator.weightedFrequency += power * frequency;
      }
    }
  }

  const coveredEnergy = accumulators.reduce((sum, band) => sum + band.energy, 0);
  const dominantBand = accumulators.toSorted((a, b) => b.energy - a.energy)[0];
  const groupShare = (group: FrequencyBandDefinition['group']): number => (
    accumulators
      .filter((band) => band.group === group)
      .reduce((sum, band) => sum + band.energy, 0) / Math.max(coveredEnergy, EPSILON)
  );

  return {
    bands: accumulators.map((band) => ({
      bandId: band.bandId,
      label: band.label,
      minFrequency: band.minFrequency,
      maxFrequency: band.maxFrequency,
      rmsDb: powerToDb(band.energy / Math.max(1, parameters.frameCount * band.binCount)),
      peakDb: powerToDb(band.peakPower),
      energyShare: coveredEnergy > EPSILON ? band.energy / coveredEnergy : 0,
      centroidHz: band.energy > EPSILON
        ? band.weightedFrequency / band.energy
        : (band.minFrequency + band.maxFrequency) / 2,
    })),
    summary: {
      spectralCentroidHz: totalEnergy > EPSILON ? totalWeightedFrequency / totalEnergy : 0,
      lowEnergyShare: groupShare('low'),
      midEnergyShare: groupShare('mid'),
      highEnergyShare: groupShare('high'),
      ...(dominantBand && dominantBand.energy > EPSILON ? { dominantBandId: dominantBand.bandId } : {}),
    },
  };
}
