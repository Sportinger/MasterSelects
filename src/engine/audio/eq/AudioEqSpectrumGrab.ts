import { AUDIO_EQ_MAX_BANDS, type AudioEqBand, type AudioEqParamsV2 } from './AudioEqTypes';
import { createAudioEqBand } from './AudioEqDefaults';
import { normalizeAudioEqParams } from './AudioEqLegacy';

const MIN_FREQUENCY_HZ = 20;
const MAX_FREQUENCY_HZ = 20_000;

export interface AudioEqSpectrumGrabPeak {
  id: string;
  frequencyHz: number;
  magnitudeDb: number;
  prominenceDb: number;
  q: number;
}

export interface AudioEqSpectrumGrabOptions {
  maxPeaks?: number;
  minProminenceDb?: number;
  minMagnitudeDb?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function frequencyAtIndex(index: number, length: number): number {
  const t = index / Math.max(1, length - 1);
  const minLog = Math.log10(MIN_FREQUENCY_HZ);
  const maxLog = Math.log10(MAX_FREQUENCY_HZ);
  return Math.pow(10, minLog + t * (maxLog - minLog));
}

function estimatePeakQ(valuesDb: Float32Array, index: number, prominenceDb: number): number {
  const peakDb = valuesDb[index] ?? -120;
  const thresholdDb = peakDb - Math.max(1, prominenceDb * 0.5);
  let left = index;
  let right = index;

  while (left > 0 && (valuesDb[left - 1] ?? -120) >= thresholdDb) {
    left -= 1;
  }
  while (right < valuesDb.length - 1 && (valuesDb[right + 1] ?? -120) >= thresholdDb) {
    right += 1;
  }

  const centerHz = frequencyAtIndex(index, valuesDb.length);
  const lowHz = frequencyAtIndex(left, valuesDb.length);
  const highHz = frequencyAtIndex(right, valuesDb.length);
  return clamp(centerHz / Math.max(12, highHz - lowHz), 0.35, 36);
}

function localFloor(valuesDb: Float32Array, index: number): number {
  const radius = 5;
  let sum = 0;
  let count = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    if (Math.abs(offset) <= 1) continue;
    const sampleIndex = Math.max(0, Math.min(valuesDb.length - 1, index + offset));
    sum += valuesDb[sampleIndex] ?? -120;
    count += 1;
  }
  return sum / Math.max(1, count);
}

export function detectAudioEqSpectrumGrabPeaks(
  valuesDb: Float32Array | undefined,
  options: AudioEqSpectrumGrabOptions = {},
): AudioEqSpectrumGrabPeak[] {
  if (!valuesDb || valuesDb.length < 5) return [];

  const maxPeaks = Math.max(1, Math.min(24, Math.round(options.maxPeaks ?? 8)));
  const minProminenceDb = Math.max(0.1, options.minProminenceDb ?? 4);
  const minMagnitudeDb = options.minMagnitudeDb ?? -72;
  const peaks: AudioEqSpectrumGrabPeak[] = [];

  for (let index = 2; index < valuesDb.length - 2; index += 1) {
    const value = valuesDb[index] ?? -120;
    if (value < minMagnitudeDb) continue;
    if (
      value < (valuesDb[index - 1] ?? -120) ||
      value < (valuesDb[index + 1] ?? -120) ||
      value < (valuesDb[index - 2] ?? -120) ||
      value < (valuesDb[index + 2] ?? -120)
    ) {
      continue;
    }

    const prominenceDb = value - localFloor(valuesDb, index);
    if (prominenceDb < minProminenceDb) continue;

    const frequencyHz = frequencyAtIndex(index, valuesDb.length);
    peaks.push({
      id: `peak-${index}-${Math.round(frequencyHz)}hz`,
      frequencyHz,
      magnitudeDb: value,
      prominenceDb,
      q: estimatePeakQ(valuesDb, index, prominenceDb),
    });
  }

  return peaks
    .sort((a, b) => b.prominenceDb - a.prominenceDb)
    .filter((peak, index, sorted) => sorted.findIndex(other =>
      Math.abs(Math.log2(other.frequencyHz / peak.frequencyHz)) < 0.18
    ) === index)
    .slice(0, maxPeaks)
    .sort((a, b) => a.frequencyHz - b.frequencyHz);
}

function createBandFromPeak(peak: AudioEqSpectrumGrabPeak, index: number): AudioEqBand {
  const cutDb = -clamp(peak.prominenceDb * 0.72, 1.5, 12);
  return createAudioEqBand({
    id: `grab-${index + 1}-${Math.round(peak.frequencyHz)}hz`,
    type: peak.q >= 10 ? 'notch' : 'bell',
    frequencyHz: Math.round(peak.frequencyHz),
    gainDb: peak.q >= 10 ? 0 : Number(cutDb.toFixed(2)),
    q: Number(clamp(peak.q, 0.6, 40).toFixed(2)),
  });
}

function uniqueBandIds(bands: readonly AudioEqBand[]): AudioEqBand[] {
  const usedIds = new Set<string>();
  return bands.map((band, index) => {
    let id = band.id;
    while (usedIds.has(id)) {
      id = `${band.id}-${index + 1}`;
    }
    usedIds.add(id);
    return id === band.id ? band : { ...band, id };
  });
}

export function applyAudioEqSpectrumGrabPeak(
  params: AudioEqParamsV2 | unknown,
  peak: AudioEqSpectrumGrabPeak,
  options: { replaceNearest?: boolean } = {},
): AudioEqParamsV2 {
  const normalized = normalizeAudioEqParams(params);
  const generated = createBandFromPeak(peak, normalized.audible.bands.length);
  const nearestIndex = normalized.audible.bands.findIndex(band =>
    Math.abs(Math.log2(band.frequencyHz / generated.frequencyHz)) < 0.08
  );

  const bands = options.replaceNearest && nearestIndex >= 0
    ? normalized.audible.bands.map((band, index) => index === nearestIndex ? { ...generated, id: band.id } : band)
    : uniqueBandIds([...normalized.audible.bands, generated]).slice(0, AUDIO_EQ_MAX_BANDS);

  return {
    ...normalized,
    audible: {
      ...normalized.audible,
      presetKind: 'custom',
      bands,
    },
    display: {
      ...normalized.display,
      selectedBandIds: [nearestIndex >= 0 && options.replaceNearest
        ? normalized.audible.bands[nearestIndex]?.id ?? generated.id
        : generated.id],
    },
  };
}
