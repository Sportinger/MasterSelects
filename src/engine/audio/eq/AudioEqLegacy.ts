import { AUDIO_EQ_MAX_BANDS, AUDIO_EQ_SCHEMA_VERSION, type AudioEqAnalyzerMode, type AudioEqAudibleStateV2, type AudioEqBand, type AudioEqBandStereoMode, type AudioEqBandType, type AudioEqCharacterMode, type AudioEqDisplayStateV2, type AudioEqParamsV2, type AudioEqPhaseMode, type AudioEqPresetKind } from './AudioEqTypes';
import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
  AUDIO_EQ_DEFAULT_Q,
  AUDIO_EQ_LEGACY_BANDS,
  createAudioEqBand,
  createDefaultAudioEqDisplayState,
  createParametricAudioEqParams,
  createTenBandGraphicAudioEqParams,
} from './AudioEqDefaults';

const PHASE_MODES = new Set<AudioEqPhaseMode>(['zero-latency', 'natural', 'linear']);
const CHARACTER_MODES = new Set<AudioEqCharacterMode>(['clean', 'subtle', 'warm']);
const ANALYZER_MODES = new Set<AudioEqAnalyzerMode>(['off', 'pre', 'post', 'pre-post']);
const PRESET_KINDS = new Set<AudioEqPresetKind>(['3-band', '10-band-graphic', 'parametric', 'mastering', 'match', 'custom']);
const BAND_TYPES = new Set<AudioEqBandType>([
  'bell',
  'low-shelf',
  'high-shelf',
  'low-cut',
  'high-cut',
  'notch',
  'band-pass',
  'tilt-shelf',
  'all-pass',
]);
const STEREO_MODES = new Set<AudioEqBandStereoMode>(['stereo', 'left', 'right', 'mid', 'side', 'surround']);
const DISPLAY_RANGES = new Set([3, 6, 12, 30]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

function displayRange(value: unknown, fallback: 3 | 6 | 12 | 30): 3 | 6 | 12 | 30 {
  return DISPLAY_RANGES.has(value as number) ? value as 3 | 6 | 12 | 30 : fallback;
}

function sourceEqCandidate(params: unknown): unknown {
  if (isRecord(params) && isRecord(params.eq)) {
    return params.eq;
  }

  return params;
}

function normalizeBand(input: unknown, index: number, usedIds: Set<string>): AudioEqBand | null {
  if (!isRecord(input)) {
    return null;
  }

  const fallbackId = `band-${index + 1}`;
  let id = typeof input.id === 'string' && input.id.length > 0 ? input.id : fallbackId;
  if (usedIds.has(id)) {
    id = `${id}-${index + 1}`;
  }
  usedIds.add(id);

  return createAudioEqBand({
    id,
    enabled: booleanValue(input.enabled, true),
    type: enumValue(input.type, BAND_TYPES, 'bell'),
    frequencyHz: finiteNumberInRange(input.frequencyHz, 1000, 20, 22000),
    gainDb: finiteNumberInRange(input.gainDb, 0, -60, 60),
    q: finiteNumberInRange(input.q, AUDIO_EQ_DEFAULT_Q, 0.025, 100),
    ...(input.slopeDbPerOct !== undefined
      ? { slopeDbPerOct: finiteNumberInRange(input.slopeDbPerOct, 12, 0.1, 120) }
      : {}),
    ...(input.brickwall !== undefined ? { brickwall: booleanValue(input.brickwall, false) } : {}),
    stereoMode: enumValue(input.stereoMode, STEREO_MODES, 'stereo'),
    ...(stringArray(input.channelMask) ? { channelMask: stringArray(input.channelMask) } : {}),
    ...(isRecord(input.dynamic)
      ? {
          dynamic: {
            enabled: booleanValue(input.dynamic.enabled, AUDIO_EQ_DEFAULT_BAND_DYNAMICS.enabled),
            mode: enumValue(input.dynamic.mode, new Set(['compress', 'expand']), AUDIO_EQ_DEFAULT_BAND_DYNAMICS.mode),
            thresholdDb: finiteNumberInRange(input.dynamic.thresholdDb, AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb, -120, 24),
            rangeDb: finiteNumberInRange(input.dynamic.rangeDb, AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb, 0, 60),
            ratio: finiteNumberInRange(input.dynamic.ratio, AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio, 0.1, 100),
            attackMs: finiteNumberInRange(input.dynamic.attackMs, AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs, 0.1, 5000),
            releaseMs: finiteNumberInRange(input.dynamic.releaseMs, AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs, 1, 10000),
            sidechainMode: enumValue(input.dynamic.sidechainMode, new Set(['self', 'external']), AUDIO_EQ_DEFAULT_BAND_DYNAMICS.sidechainMode),
            ...(input.dynamic.sidechainFilterHz !== undefined
              ? { sidechainFilterHz: finiteNumberInRange(input.dynamic.sidechainFilterHz, 1000, 20, 22000) }
              : {}),
            ...(input.dynamic.sidechainFilterQ !== undefined
              ? { sidechainFilterQ: finiteNumberInRange(input.dynamic.sidechainFilterQ, 1, 0.025, 100) }
              : {}),
          },
        }
      : {}),
    ...(isRecord(input.spectralDynamics)
      ? {
          spectralDynamics: {
            enabled: booleanValue(input.spectralDynamics.enabled, AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.enabled),
            mode: enumValue(input.spectralDynamics.mode, new Set(['compress', 'expand']), AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.mode),
            thresholdDb: finiteNumberInRange(input.spectralDynamics.thresholdDb, AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb, -120, 24),
            rangeDb: finiteNumberInRange(input.spectralDynamics.rangeDb, AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb, 0, 60),
            ratio: finiteNumberInRange(input.spectralDynamics.ratio, AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio, 0.1, 100),
            attackMs: finiteNumberInRange(input.spectralDynamics.attackMs, AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs, 0.1, 5000),
            releaseMs: finiteNumberInRange(input.spectralDynamics.releaseMs, AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs, 1, 10000),
            resolution: enumValue(input.spectralDynamics.resolution, new Set(['low-latency', 'balanced', 'mastering']), AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.resolution),
          },
        }
      : {}),
  });
}

function normalizeDisplayState(input: unknown, normalizedBandIds: ReadonlySet<string>): AudioEqDisplayStateV2 {
  const defaults = createDefaultAudioEqDisplayState();
  if (!isRecord(input)) {
    return defaults;
  }

  const selectedBandIds = stringArray(input.selectedBandIds)?.filter(id => normalizedBandIds.has(id)) ?? [];
  const soloBandIds = stringArray(input.soloBandIds)?.filter(id => normalizedBandIds.has(id)) ?? [];
  return {
    analyzerMode: enumValue(input.analyzerMode, ANALYZER_MODES, defaults.analyzerMode),
    analyzerRangeDb: displayRange(input.analyzerRangeDb, defaults.analyzerRangeDb),
    pianoDisplay: booleanValue(input.pianoDisplay, defaults.pianoDisplay),
    graphRangeDb: displayRange(input.graphRangeDb, defaults.graphRangeDb),
    showPhaseCurve: booleanValue(input.showPhaseCurve, defaults.showPhaseCurve ?? false),
    showGainReduction: booleanValue(input.showGainReduction, defaults.showGainReduction ?? false),
    selectedBandIds,
    soloBandIds,
  };
}

function normalizeV2Params(input: Record<string, unknown>): AudioEqParamsV2 {
  const audibleInput = isRecord(input.audible) ? input.audible : {};
  const usedIds = new Set<string>();
  const bands = Array.isArray(audibleInput.bands)
    ? audibleInput.bands
        .slice(0, AUDIO_EQ_MAX_BANDS)
        .map((band, index) => normalizeBand(band, index, usedIds))
        .filter((band): band is AudioEqBand => Boolean(band))
    : [];
  const fallback = createTenBandGraphicAudioEqParams();
  const normalizedBands = bands.length > 0 ? bands : fallback.audible.bands;
  const bandIds = new Set(normalizedBands.map(band => band.id));

  return {
    schemaVersion: AUDIO_EQ_SCHEMA_VERSION,
    audible: {
      presetKind: enumValue(audibleInput.presetKind, PRESET_KINDS, fallback.audible.presetKind),
      phaseMode: enumValue(audibleInput.phaseMode, PHASE_MODES, fallback.audible.phaseMode),
      characterMode: enumValue(audibleInput.characterMode, CHARACTER_MODES, fallback.audible.characterMode),
      bands: normalizedBands,
    },
    display: normalizeDisplayState(input.display, bandIds),
    ...(isRecord(input.provenance) ? { provenance: normalizeProvenance(input.provenance) } : {}),
  };
}

function normalizeProvenance(input: Record<string, unknown>): AudioEqParamsV2['provenance'] {
  return {
    ...(isRecord(input.match)
      ? {
          match: {
            enabled: booleanValue(input.match.enabled, false),
            ...(typeof input.match.sourceRef === 'string' ? { sourceRef: input.match.sourceRef } : {}),
            ...(typeof input.match.targetRef === 'string' ? { targetRef: input.match.targetRef } : {}),
            amount: finiteNumberInRange(input.match.amount, 1, 0, 1),
            smoothing: finiteNumberInRange(input.match.smoothing, 0.5, 0, 1),
            ...(typeof input.match.generatedAt === 'string' ? { generatedAt: input.match.generatedAt } : {}),
          },
        }
      : {}),
    ...(isRecord(input.sketch)
      ? {
          sketch: {
            ...(typeof input.sketch.lastStrokeId === 'string' ? { lastStrokeId: input.sketch.lastStrokeId } : {}),
            ...(stringArray(input.sketch.fittedBandIds) ? { fittedBandIds: stringArray(input.sketch.fittedBandIds) } : {}),
            simplification: finiteNumberInRange(input.sketch.simplification, 0.5, 0, 1),
            maxGeneratedBands: Math.round(finiteNumberInRange(input.sketch.maxGeneratedBands, AUDIO_EQ_MAX_BANDS, 1, AUDIO_EQ_MAX_BANDS)),
          },
        }
      : {}),
  };
}

function normalizeLegacyGraphicEqParams(params: unknown): AudioEqParamsV2 {
  const source = isRecord(params) ? params : {};
  const normalized = createTenBandGraphicAudioEqParams();
  normalized.audible.bands = normalized.audible.bands.map((band) => ({
    ...band,
    gainDb: finiteNumberInRange(source[band.id], 0, -60, 60),
  }));
  return normalized;
}

export function normalizeAudioEqParams(params: unknown): AudioEqParamsV2 {
  const candidate = sourceEqCandidate(params);
  if (isRecord(candidate) && candidate.schemaVersion === AUDIO_EQ_SCHEMA_VERSION) {
    return normalizeV2Params(candidate);
  }

  return normalizeLegacyGraphicEqParams(params);
}

export function normalizeLegacyParametricAudioEqParams(params: unknown): AudioEqParamsV2 {
  const source = isRecord(params) ? params : {};
  return createParametricAudioEqParams({
    frequencyHz: finiteNumberInRange(source.frequencyHz, 1000, 20, 22000),
    gainDb: finiteNumberInRange(source.gainDb, 0, -60, 60),
    q: finiteNumberInRange(source.q, 1, 0.025, 100),
  });
}

export function getAudioEqAudibleStateForIdentity(params: unknown): AudioEqAudibleStateV2 {
  const normalized = normalizeAudioEqParams(params);
  return {
    ...normalized.audible,
    bands: normalized.audible.bands.map(band => ({ ...band })),
  };
}

export function getAudioEqLegacyBandGains(params: unknown): number[] {
  const normalized = normalizeAudioEqParams(params);
  return AUDIO_EQ_LEGACY_BANDS.map((legacyBand) => {
    const band = normalized.audible.bands.find(candidate => candidate.id === legacyBand.id);
    return band?.enabled === false ? 0 : finiteNumberInRange(band?.gainDb, 0, -60, 60);
  });
}

export function isAudioEqAudibleStateDefault(params: unknown): boolean {
  const current = getAudioEqAudibleStateForIdentity(params);
  const defaults = createTenBandGraphicAudioEqParams().audible;
  if (
    current.presetKind !== defaults.presetKind ||
    current.phaseMode !== defaults.phaseMode ||
    current.characterMode !== defaults.characterMode ||
    current.bands.length !== defaults.bands.length
  ) {
    return false;
  }

  return defaults.bands.every((defaultBand, index) => {
    const band = current.bands[index];
    return Boolean(band) &&
      band.id === defaultBand.id &&
      band.enabled === defaultBand.enabled &&
      band.type === defaultBand.type &&
      band.stereoMode === defaultBand.stereoMode &&
      Math.abs(band.frequencyHz - defaultBand.frequencyHz) < 0.001 &&
      Math.abs(band.gainDb - defaultBand.gainDb) <= 0.01 &&
      Math.abs(band.q - defaultBand.q) < 0.001 &&
      band.dynamic?.enabled !== true &&
      band.spectralDynamics?.enabled !== true;
  });
}
