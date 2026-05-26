import { AUDIO_EQ_MAX_BANDS, type AudioEqBand, type AudioEqParamsV2 } from './AudioEqTypes';
import { createAudioEqBand } from './AudioEqDefaults';
import { normalizeAudioEqParams } from './AudioEqLegacy';

const MIN_FREQUENCY_HZ = 20;
const MAX_FREQUENCY_HZ = 20_000;

export interface AudioEqCurvePoint {
  frequencyHz: number;
  gainDb: number;
  weight?: number;
}

export interface AudioEqCurveFitOptions {
  maxBands?: number;
  minGainDb?: number;
  idPrefix?: string;
}

export interface AudioEqCurveFitResult {
  bands: AudioEqBand[];
  sampledCurve: AudioEqCurvePoint[];
}

interface FitCandidate {
  frequencyHz: number;
  gainDb: number;
  q: number;
  score: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function logFrequencyT(frequencyHz: number): number {
  const minLog = Math.log10(MIN_FREQUENCY_HZ);
  const maxLog = Math.log10(MAX_FREQUENCY_HZ);
  return (Math.log10(clamp(frequencyHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ)) - minLog) / (maxLog - minLog);
}

function frequencyFromLogT(t: number): number {
  const minLog = Math.log10(MIN_FREQUENCY_HZ);
  const maxLog = Math.log10(MAX_FREQUENCY_HZ);
  return Math.pow(10, minLog + clamp(t, 0, 1) * (maxLog - minLog));
}

function sanitizePoints(points: readonly AudioEqCurvePoint[]): AudioEqCurvePoint[] {
  return points
    .filter(point => Number.isFinite(point.frequencyHz) && Number.isFinite(point.gainDb))
    .map(point => ({
      frequencyHz: clamp(point.frequencyHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ),
      gainDb: clamp(point.gainDb, -30, 30),
      ...(point.weight !== undefined ? { weight: clamp(point.weight, 0, 1) } : {}),
    }))
    .sort((a, b) => a.frequencyHz - b.frequencyHz);
}

function interpolateCurve(points: readonly AudioEqCurvePoint[], frequencyHz: number): number {
  if (points.length === 0) return 0;
  if (frequencyHz <= points[0].frequencyHz) return points[0].gainDb;
  if (frequencyHz >= points[points.length - 1].frequencyHz) return points[points.length - 1].gainDb;

  const targetT = logFrequencyT(frequencyHz);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (!previous || !next || frequencyHz > next.frequencyHz) continue;
    const previousT = logFrequencyT(previous.frequencyHz);
    const nextT = logFrequencyT(next.frequencyHz);
    const localT = (targetT - previousT) / Math.max(0.000001, nextT - previousT);
    return previous.gainDb + clamp(localT, 0, 1) * (next.gainDb - previous.gainDb);
  }

  return 0;
}

function sampleCurve(points: readonly AudioEqCurvePoint[], count: number): AudioEqCurvePoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    const frequencyHz = frequencyFromLogT(t);
    return {
      frequencyHz,
      gainDb: interpolateCurve(points, frequencyHz),
    };
  });
}

function smoothCurve(points: readonly AudioEqCurvePoint[]): AudioEqCurvePoint[] {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    return {
      ...point,
      gainDb: previous.gainDb * 0.22 + point.gainDb * 0.56 + next.gainDb * 0.22,
    };
  });
}

function estimateQ(samples: readonly AudioEqCurvePoint[], index: number, minGainDb: number): number {
  const point = samples[index];
  if (!point) return 1;
  const sign = Math.sign(point.gainDb) || 1;
  const halfGain = Math.max(minGainDb * 0.6, Math.abs(point.gainDb) * 0.5);
  let left = index;
  let right = index;

  while (left > 0 && Math.sign(samples[left - 1]?.gainDb ?? 0) === sign && Math.abs(samples[left - 1]?.gainDb ?? 0) >= halfGain) {
    left -= 1;
  }
  while (right < samples.length - 1 && Math.sign(samples[right + 1]?.gainDb ?? 0) === sign && Math.abs(samples[right + 1]?.gainDb ?? 0) >= halfGain) {
    right += 1;
  }

  const lowHz = samples[left]?.frequencyHz ?? point.frequencyHz / 2;
  const highHz = samples[right]?.frequencyHz ?? point.frequencyHz * 2;
  const bandwidthHz = Math.max(12, highHz - lowHz);
  return clamp(point.frequencyHz / bandwidthHz, 0.18, 32);
}

function createCandidates(samples: readonly AudioEqCurvePoint[], minGainDb: number): FitCandidate[] {
  const candidates: FitCandidate[] = [];

  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];
    if (!previous || !current || !next) continue;

    const abs = Math.abs(current.gainDb);
    if (abs < minGainDb) continue;

    const localMaximum = abs >= Math.abs(previous.gainDb) && abs >= Math.abs(next.gainDb);
    const signChangeNearby = Math.sign(previous.gainDb) !== Math.sign(next.gainDb);
    if (!localMaximum && !signChangeNearby) continue;

    candidates.push({
      frequencyHz: current.frequencyHz,
      gainDb: clamp(current.gainDb, -18, 18),
      q: estimateQ(samples, index, minGainDb),
      score: abs * (1 + Math.min(1, Math.abs(current.gainDb - previous.gainDb) + Math.abs(current.gainDb - next.gainDb)) / 12),
    });
  }

  if (candidates.length === 0) {
    let strongest: AudioEqCurvePoint | undefined;
    for (const point of samples) {
      if (!strongest || Math.abs(point.gainDb) > Math.abs(strongest.gainDb)) {
        strongest = point;
      }
    }
    if (strongest && Math.abs(strongest.gainDb) >= minGainDb) {
      candidates.push({
        frequencyHz: strongest.frequencyHz,
        gainDb: clamp(strongest.gainDb, -18, 18),
        q: 1,
        score: Math.abs(strongest.gainDb),
      });
    }
  }

  return candidates;
}

function isFarEnough(candidate: FitCandidate, accepted: readonly FitCandidate[]): boolean {
  const t = logFrequencyT(candidate.frequencyHz);
  return accepted.every(item => Math.abs(logFrequencyT(item.frequencyHz) - t) >= 0.055);
}

function candidateToBand(candidate: FitCandidate, index: number, idPrefix: string): AudioEqBand {
  return createAudioEqBand({
    id: `${idPrefix}-${index + 1}-${Math.round(candidate.frequencyHz)}hz`,
    type: 'bell',
    frequencyHz: Math.round(candidate.frequencyHz),
    gainDb: Number(candidate.gainDb.toFixed(2)),
    q: Number(candidate.q.toFixed(2)),
  });
}

export function fitAudioEqBandsToCurve(
  points: readonly AudioEqCurvePoint[],
  options: AudioEqCurveFitOptions = {},
): AudioEqCurveFitResult {
  const sanitized = sanitizePoints(points);
  if (sanitized.length < 2) {
    return { bands: [], sampledCurve: [] };
  }

  const maxBands = Math.max(1, Math.min(AUDIO_EQ_MAX_BANDS, Math.round(options.maxBands ?? 8)));
  const minGainDb = Math.max(0.1, options.minGainDb ?? 0.75);
  const idPrefix = options.idPrefix ?? 'fit';
  const sampledCurve = smoothCurve(sampleCurve(sanitized, 96));
  const candidates = createCandidates(sampledCurve, minGainDb)
    .sort((a, b) => b.score - a.score);
  const accepted: FitCandidate[] = [];

  for (const candidate of candidates) {
    if (accepted.length >= maxBands) break;
    if (!isFarEnough(candidate, accepted)) continue;
    accepted.push(candidate);
  }

  accepted.sort((a, b) => a.frequencyHz - b.frequencyHz);
  return {
    bands: accepted.map((candidate, index) => candidateToBand(candidate, index, idPrefix)),
    sampledCurve,
  };
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

export function applyAudioEqCurveFit(
  params: AudioEqParamsV2 | unknown,
  points: readonly AudioEqCurvePoint[],
  options: AudioEqCurveFitOptions & {
    amount?: number;
    mode?: 'replace' | 'append';
    smoothing?: number;
    source?: 'sketch' | 'match';
  } = {},
): AudioEqParamsV2 {
  const normalized = normalizeAudioEqParams(params);
  const fit = fitAudioEqBandsToCurve(points, options);
  if (fit.bands.length === 0) {
    return normalized;
  }

  const mode = options.mode ?? 'replace';
  const nextBands = mode === 'append'
    ? uniqueBandIds([...normalized.audible.bands, ...fit.bands]).slice(0, AUDIO_EQ_MAX_BANDS)
    : fit.bands;

  return {
    ...normalized,
    audible: {
      ...normalized.audible,
      presetKind: 'custom',
      bands: nextBands,
    },
    display: {
      ...normalized.display,
      selectedBandIds: fit.bands.map(band => band.id),
    },
    provenance: {
      ...normalized.provenance,
      ...(options.source === 'match'
        ? {
            match: {
              enabled: true,
              amount: clamp(options.amount ?? 1, 0, 1),
              smoothing: clamp(options.smoothing ?? 0.5, 0, 1),
            },
          }
        : {
            sketch: {
              lastStrokeId: `sketch-${fit.sampledCurve.length}-${fit.bands.length}`,
              fittedBandIds: fit.bands.map(band => band.id),
              simplification: 0.5,
              maxGeneratedBands: options.maxBands ?? 8,
            },
          }),
    },
  };
}

export function createAudioEqCurvePointsFromSpectrumDelta(
  sourceDb: Float32Array,
  targetDb: Float32Array,
  options: { amount?: number; smoothing?: number } = {},
): AudioEqCurvePoint[] {
  const length = Math.min(sourceDb.length, targetDb.length);
  const amount = clamp(options.amount ?? 1, 0, 1);
  const smoothingRadius = Math.max(0, Math.round(clamp(options.smoothing ?? 0.5, 0, 1) * 8));
  const points: AudioEqCurvePoint[] = [];

  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -smoothingRadius; offset <= smoothingRadius; offset += 1) {
      const sampleIndex = Math.max(0, Math.min(length - 1, index + offset));
      sum += (targetDb[sampleIndex] ?? -96) - (sourceDb[sampleIndex] ?? -96);
      count += 1;
    }
    const t = index / Math.max(1, length - 1);
    points.push({
      frequencyHz: frequencyFromLogT(t),
      gainDb: clamp((sum / Math.max(1, count)) * amount, -18, 18),
    });
  }

  return points;
}

export function applyAudioEqMatch(
  params: AudioEqParamsV2 | unknown,
  sourceDb: Float32Array,
  targetDb: Float32Array,
  options: AudioEqCurveFitOptions & { amount?: number; smoothing?: number } = {},
): AudioEqParamsV2 {
  return applyAudioEqCurveFit(
    params,
    createAudioEqCurvePointsFromSpectrumDelta(sourceDb, targetDb, options),
    {
      ...options,
      idPrefix: options.idPrefix ?? 'match',
      mode: 'replace',
      source: 'match',
    },
  );
}
