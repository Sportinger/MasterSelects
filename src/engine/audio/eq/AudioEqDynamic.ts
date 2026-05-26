import { createAudioEqBiquadCascadeCoefficients, createAudioEqBiquadCoefficients } from './AudioEqBiquad';
import { createDefaultAudioEqDisplayState } from './AudioEqDefaults';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import {
  AUDIO_EQ_SCHEMA_VERSION,
  type AudioEqBand,
  type AudioEqBandDynamics,
  type AudioEqBiquadCoefficients,
  type AudioEqParamsV2,
} from './AudioEqTypes';

const MIN_ENVELOPE = 1e-8;
const COEFFICIENT_GAIN_STEP_DB = 0.05;

interface BiquadRuntimeState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

interface DynamicBandRuntimeState {
  bandId: string;
  filterStates: BiquadRuntimeState[][];
  detectorStates: BiquadRuntimeState[];
  envelopes: number[];
  coefficients: AudioEqBiquadCoefficients[];
  detectorCoefficients: AudioEqBiquadCoefficients;
  lastCoefficientGainDb: number;
  maxGainReductionDb: number;
  maxExpansionDb: number;
  lastEnvelopeDb: number;
  lastDynamicGainDb: number;
}

export interface AudioEqDynamicRuntimeState {
  bands: DynamicBandRuntimeState[];
}

export interface AudioEqDynamicBandTelemetry {
  bandId: string;
  maxGainReductionDb: number;
  maxExpansionDb: number;
  lastEnvelopeDb: number;
  lastDynamicGainDb: number;
}

export interface AudioEqDynamicProcessResult {
  channels: Float32Array[];
  telemetry: AudioEqDynamicBandTelemetry[];
}

function createBiquadRuntimeState(): BiquadRuntimeState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquadSample(
  coefficients: AudioEqBiquadCoefficients,
  state: BiquadRuntimeState,
  input: number,
): number {
  const output = coefficients.b0 * input +
    coefficients.b1 * state.x1 +
    coefficients.b2 * state.x2 -
    coefficients.a1 * state.y1 -
    coefficients.a2 * state.y2;

  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = Number.isFinite(output) ? output : 0;
  return state.y1;
}

function linearToDb(value: number): number {
  return 20 * Math.log10(Math.max(MIN_ENVELOPE, value));
}

function timeCoefficient(milliseconds: number, sampleRate: number): number {
  const seconds = Math.max(0.0001, milliseconds / 1000);
  return Math.exp(-1 / Math.max(1, seconds * sampleRate));
}

function createDetectorBand(band: AudioEqBand): AudioEqBand {
  return {
    ...band,
    type: 'band-pass',
    frequencyHz: band.dynamic?.sidechainFilterHz ?? band.frequencyHz,
    q: band.dynamic?.sidechainFilterQ ?? Math.max(0.25, Math.min(24, band.q)),
    gainDb: 0,
  };
}

function isDynamicGainBand(band: AudioEqBand): boolean {
  return band.type === 'bell' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf' ||
    band.type === 'tilt-shelf';
}

function createBandRuntimeState(
  band: AudioEqBand,
  channelCount: number,
  sampleRate: number,
): DynamicBandRuntimeState {
  const coefficients = createAudioEqBiquadCascadeCoefficients(band, sampleRate);
  return {
    bandId: band.id,
    filterStates: Array.from(
      { length: channelCount },
      () => coefficients.map(createBiquadRuntimeState),
    ),
    detectorStates: Array.from({ length: channelCount }, createBiquadRuntimeState),
    envelopes: new Array(channelCount).fill(MIN_ENVELOPE),
    coefficients,
    detectorCoefficients: createAudioEqBiquadCoefficients(createDetectorBand(band), sampleRate),
    lastCoefficientGainDb: band.gainDb,
    maxGainReductionDb: 0,
    maxExpansionDb: 0,
    lastEnvelopeDb: -160,
    lastDynamicGainDb: 0,
  };
}

function getRuntimeBandState(
  state: AudioEqDynamicRuntimeState,
  band: AudioEqBand,
  channelCount: number,
  sampleRate: number,
): DynamicBandRuntimeState {
  let bandState = state.bands.find(candidate => candidate.bandId === band.id);
  if (!bandState || bandState.filterStates.length !== channelCount) {
    bandState = createBandRuntimeState(band, channelCount, sampleRate);
    state.bands = [
      ...state.bands.filter(candidate => candidate.bandId !== band.id),
      bandState,
    ];
  }
  return bandState;
}

export function createAudioEqDynamicRuntimeState(): AudioEqDynamicRuntimeState {
  return { bands: [] };
}

export function hasAudioEqDynamicBands(params: AudioEqParamsV2 | unknown): boolean {
  return normalizeAudioEqParams(params).audible.bands.some(band => (
    band.enabled !== false &&
    band.dynamic?.enabled === true &&
    isDynamicGainBand(band)
  ));
}

export function calculateAudioEqDynamicGainDb(
  dynamics: AudioEqBandDynamics,
  envelopeDb: number,
): number {
  if (!dynamics.enabled || envelopeDb <= dynamics.thresholdDb) {
    return 0;
  }

  const ratio = Math.max(1, dynamics.ratio);
  const overThresholdDb = envelopeDb - dynamics.thresholdDb;
  const ratioAmountDb = overThresholdDb * (1 - 1 / ratio);
  const amountDb = Math.max(0, Math.min(dynamics.rangeDb, ratioAmountDb));
  return dynamics.mode === 'expand' ? amountDb : -amountDb;
}

export function createSingleBandAudioEqParams(band: AudioEqBand): AudioEqParamsV2 {
  return {
    schemaVersion: AUDIO_EQ_SCHEMA_VERSION,
    audible: {
      presetKind: 'custom',
      phaseMode: 'zero-latency',
      characterMode: 'clean',
      bands: [band],
    },
    display: createDefaultAudioEqDisplayState(),
  };
}

export function processAudioEqChannels(
  channels: readonly Float32Array[],
  params: AudioEqParamsV2 | unknown,
  options: {
    sampleRate: number;
    state?: AudioEqDynamicRuntimeState;
  },
): AudioEqDynamicProcessResult {
  const normalized = normalizeAudioEqParams(params);
  const channelCount = channels.length;
  const output = channels.map(channel => new Float32Array(channel));
  const state = options.state ?? createAudioEqDynamicRuntimeState();
  const sampleRate = Math.max(1, options.sampleRate);

  for (const band of normalized.audible.bands) {
    if (band.enabled === false || band.stereoMode !== 'stereo') {
      continue;
    }

    const bandState = getRuntimeBandState(state, band, channelCount, sampleRate);
    const dynamics = band.dynamic?.enabled === true && isDynamicGainBand(band)
      ? band.dynamic
      : undefined;
    const attackCoefficient = dynamics ? timeCoefficient(dynamics.attackMs, sampleRate) : 0;
    const releaseCoefficient = dynamics ? timeCoefficient(dynamics.releaseMs, sampleRate) : 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = output[channel];
      let filterState = bandState.filterStates[channel];
      const detectorState = bandState.detectorStates[channel];
      let envelope = bandState.envelopes[channel] ?? MIN_ENVELOPE;

      for (let sample = 0; sample < data.length; sample += 1) {
        const input = data[sample];
        let coefficients = bandState.coefficients;

        if (dynamics && filterState && detectorState) {
          const detectorSample = processBiquadSample(bandState.detectorCoefficients, detectorState, input);
          const level = Math.max(MIN_ENVELOPE, Math.abs(detectorSample));
          const smoothing = level > envelope ? attackCoefficient : releaseCoefficient;
          envelope = smoothing * envelope + (1 - smoothing) * level;
          const envelopeDb = linearToDb(envelope);
          const dynamicGainDb = calculateAudioEqDynamicGainDb(dynamics, envelopeDb);
          const effectiveGainDb = band.gainDb + dynamicGainDb;

          bandState.lastEnvelopeDb = envelopeDb;
          bandState.lastDynamicGainDb = dynamicGainDb;
          bandState.maxGainReductionDb = Math.max(bandState.maxGainReductionDb, Math.max(0, -dynamicGainDb));
          bandState.maxExpansionDb = Math.max(bandState.maxExpansionDb, Math.max(0, dynamicGainDb));

          if (Math.abs(effectiveGainDb - bandState.lastCoefficientGainDb) >= COEFFICIENT_GAIN_STEP_DB) {
            bandState.coefficients = createAudioEqBiquadCascadeCoefficients({
              ...band,
              gainDb: effectiveGainDb,
            }, sampleRate);
            bandState.lastCoefficientGainDb = effectiveGainDb;
            if (filterState.length !== bandState.coefficients.length) {
              bandState.filterStates[channel] = bandState.coefficients.map(createBiquadRuntimeState);
              filterState = bandState.filterStates[channel];
            }
          }
          coefficients = bandState.coefficients;
        }

        if (filterState) {
          let processed = input;
          for (let stage = 0; stage < coefficients.length; stage += 1) {
            const stageState = filterState[stage];
            const stageCoefficients = coefficients[stage];
            if (!stageState || !stageCoefficients) continue;
            processed = processBiquadSample(stageCoefficients, stageState, processed);
          }
          data[sample] = processed;
        }
      }

      bandState.envelopes[channel] = envelope;
    }
  }

  const telemetry = state.bands.map(bandState => ({
    bandId: bandState.bandId,
    maxGainReductionDb: bandState.maxGainReductionDb,
    maxExpansionDb: bandState.maxExpansionDb,
    lastEnvelopeDb: bandState.lastEnvelopeDb,
    lastDynamicGainDb: bandState.lastDynamicGainDb,
  }));

  return { channels: output, telemetry };
}
