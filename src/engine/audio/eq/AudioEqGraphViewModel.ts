import { normalizeAudioEqParams } from './AudioEqLegacy';
import {
  createAudioEqResponseSet,
  AUDIO_EQ_MAX_FREQUENCY_HZ,
  AUDIO_EQ_MIN_FREQUENCY_HZ,
  type AudioEqResponseSet,
} from './AudioEqResponse';
import type {
  AudioEqAnalyzerView,
  AudioEqBandResponseView,
  AudioEqGraphViewModel,
  AudioEqParamsV2,
} from './AudioEqTypes';

const BAND_COLORS = Object.freeze([
  '#d7e64b',
  '#f0a33f',
  '#f06a5f',
  '#4cb4ff',
  '#48d7c8',
  '#9c72ff',
  '#d85eff',
  '#65df82',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resampleResponseDb(responseDb: Float32Array, targetIndex: number, targetLength: number): number {
  if (responseDb.length === 0 || targetLength <= 1) {
    return 0;
  }

  const sourcePosition = (targetIndex / (targetLength - 1)) * (responseDb.length - 1);
  const leftIndex = Math.floor(sourcePosition);
  const rightIndex = Math.min(responseDb.length - 1, leftIndex + 1);
  const fraction = sourcePosition - leftIndex;
  const left = responseDb[leftIndex] ?? 0;
  const right = responseDb[rightIndex] ?? left;
  return left + (right - left) * fraction;
}

function createProjectedAnalyzerView(
  analyzer: AudioEqAnalyzerView | undefined,
  response: AudioEqResponseSet,
): AudioEqAnalyzerView | undefined {
  if (!analyzer) {
    return undefined;
  }

  const sourceDb = analyzer.preDb ?? analyzer.postDb;
  if (!sourceDb || sourceDb.length < 2) {
    return analyzer;
  }

  const projectedPostDb = new Float32Array(sourceDb.length);
  for (let index = 0; index < sourceDb.length; index += 1) {
    projectedPostDb[index] = sourceDb[index] + resampleResponseDb(response.summedResponseDb, index, sourceDb.length);
  }

  return {
    ...analyzer,
    preDb: analyzer.preDb ?? sourceDb,
    postDb: projectedPostDb,
    ...(analyzer.peakDb ? { peakDb: analyzer.peakDb } : {}),
  };
}

export function frequencyToGraphX(
  frequencyHz: number,
  width: number,
  minFrequencyHz = AUDIO_EQ_MIN_FREQUENCY_HZ,
  maxFrequencyHz = AUDIO_EQ_MAX_FREQUENCY_HZ,
): number {
  const minLog = Math.log10(minFrequencyHz);
  const maxLog = Math.log10(maxFrequencyHz);
  const value = clamp(Math.log10(frequencyHz), minLog, maxLog);
  return ((value - minLog) / (maxLog - minLog)) * width;
}

export function dbToGraphY(gainDb: number, height: number, rangeDb: number): number {
  const clamped = clamp(gainDb, -rangeDb, rangeDb);
  return ((rangeDb - clamped) / (rangeDb * 2)) * height;
}

export function createAudioEqGraphViewModel(
  params: AudioEqParamsV2 | unknown,
  options: {
    width: number;
    height: number;
    devicePixelRatio?: number;
    sampleRate?: number;
    sampleCount?: number;
    analyzer?: AudioEqAnalyzerView;
    hoveredBandId?: string;
  },
): AudioEqGraphViewModel {
  const normalized = normalizeAudioEqParams(params);
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const rangeDb = normalized.display.graphRangeDb;
  const response = createAudioEqResponseSet(normalized, {
    sampleRate: options.sampleRate,
    sampleCount: options.sampleCount ?? Math.max(256, Math.min(1024, Math.round(width * 1.5))),
    minFrequencyHz: AUDIO_EQ_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_MAX_FREQUENCY_HZ,
  });
  const bandById = new Map(normalized.audible.bands.map(band => [band.id, band]));
  const bandResponses: AudioEqBandResponseView[] = [];
  let colorIndex = 0;

  for (const [bandId, responseDb] of response.bandResponsesDb) {
    const band = bandById.get(bandId);
    if (!band) {
      continue;
    }

    bandResponses.push({
      bandId,
      color: BAND_COLORS[colorIndex % BAND_COLORS.length],
      enabled: band.enabled,
      responseDb,
      handle: {
        x: frequencyToGraphX(band.frequencyHz, width),
        y: dbToGraphY(band.gainDb, height, rangeDb),
        frequencyHz: band.frequencyHz,
        gainDb: band.gainDb,
      },
    });
    colorIndex += 1;
  }

  const analyzer = createProjectedAnalyzerView(options.analyzer, response);

  return {
    width,
    height,
    devicePixelRatio: options.devicePixelRatio ?? 1,
    minFrequencyHz: AUDIO_EQ_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_MAX_FREQUENCY_HZ,
    rangeDb,
    xFrequenciesHz: response.frequenciesHz,
    bandResponses,
    summedResponseDb: response.summedResponseDb,
    ...(analyzer ? { analyzer } : {}),
    selectedBandIds: normalized.display.selectedBandIds ?? [],
    ...(options.hoveredBandId ? { hoveredBandId: options.hoveredBandId } : {}),
  };
}
