import { dbToLinearGain, finiteNumber } from './audioMath';

export interface SpectralGateSettings {
  thresholdDb: number;
  reductionDb: number;
  lowFrequencyHz: number;
  highFrequencyHz: number;
  attackMs: number;
  releaseMs: number;
  mix: number;
}

export type SpectralGateSettingsReader = (timeSeconds: number) => SpectralGateSettings;

export interface SpectralGateChannelState {
  lowState: number;
  highLowState: number;
  envelopes: [number, number, number];
  gains: [number, number, number];
}

export interface SpectralGateState {
  channels: SpectralGateChannelState[];
}

interface AudioBufferBlock {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

interface NormalizedSpectralGateSettings extends SpectralGateSettings {
  lowAlpha: number;
  highAlpha: number;
  attackCoefficient: number;
  releaseCoefficient: number;
}

const MIN_AMPLITUDE = 0.000001;
const SPECTRAL_GATE_KNEE_DB = 36;

export function createSpectralGateState(): SpectralGateState {
  return { channels: [] };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function smoothingCoefficient(ms: number, sampleRate: number): number {
  return Math.exp(-1 / (sampleRate * Math.max(0.001, ms) / 1000));
}

function onePoleAlpha(frequencyHz: number, sampleRate: number): number {
  return clamp(1 - Math.exp(-2 * Math.PI * frequencyHz / sampleRate), 0.000001, 1);
}

function normalizeSpectralGateSettings(
  settings: SpectralGateSettings,
  sampleRate: number,
): NormalizedSpectralGateSettings {
  const nyquist = Math.max(40, sampleRate / 2 - 1);
  const lowFrequencyHz = clamp(finiteNumber(settings.lowFrequencyHz, 250), 20, nyquist - 20);
  const highFrequencyHz = clamp(
    finiteNumber(settings.highFrequencyHz, 5000),
    Math.min(nyquist - 1, lowFrequencyHz + 20),
    nyquist,
  );
  const attackMs = clamp(finiteNumber(settings.attackMs, 8), 0.1, 500);
  const releaseMs = clamp(finiteNumber(settings.releaseMs, 180), 1, 2000);

  return {
    thresholdDb: clamp(finiteNumber(settings.thresholdDb, -60), -100, 0),
    reductionDb: clamp(finiteNumber(settings.reductionDb, 0), 0, 80),
    lowFrequencyHz,
    highFrequencyHz,
    attackMs,
    releaseMs,
    mix: clamp(finiteNumber(settings.mix, 1), 0, 1),
    lowAlpha: onePoleAlpha(lowFrequencyHz, sampleRate),
    highAlpha: onePoleAlpha(highFrequencyHz, sampleRate),
    attackCoefficient: smoothingCoefficient(attackMs, sampleRate),
    releaseCoefficient: smoothingCoefficient(releaseMs, sampleRate),
  };
}

function getChannelState(state: SpectralGateState, channel: number): SpectralGateChannelState {
  let channelState = state.channels[channel];
  if (!channelState) {
    channelState = {
      lowState: 0,
      highLowState: 0,
      envelopes: [0, 0, 0],
      gains: [1, 1, 1],
    };
    state.channels[channel] = channelState;
  }
  return channelState;
}

function calculateBandGain(
  band: number,
  bandIndex: number,
  settings: NormalizedSpectralGateSettings,
  channelState: SpectralGateChannelState,
): number {
  let envelope = channelState.envelopes[bandIndex] ?? 0;
  const amplitude = Math.abs(band);
  const envelopeCoefficient = amplitude > envelope ? settings.attackCoefficient : settings.releaseCoefficient;
  envelope = amplitude + envelopeCoefficient * (envelope - amplitude);
  channelState.envelopes[bandIndex] = envelope;

  const envelopeDb = 20 * Math.log10(Math.max(MIN_AMPLITUDE, envelope));
  const belowThresholdDb = Math.max(0, settings.thresholdDb - envelopeDb);
  const depthDb = belowThresholdDb <= 0 || settings.reductionDb <= 0.0001
    ? 0
    : settings.reductionDb * clamp(belowThresholdDb / SPECTRAL_GATE_KNEE_DB, 0, 1);
  const targetGain = dbToLinearGain(-depthDb);

  let gain = channelState.gains[bandIndex] ?? 1;
  const gainCoefficient = targetGain < gain ? settings.attackCoefficient : settings.releaseCoefficient;
  gain = targetGain + gainCoefficient * (gain - targetGain);
  channelState.gains[bandIndex] = gain;
  return gain;
}

export function processSpectralGateBlock(
  input: AudioBufferBlock,
  output: AudioBufferBlock,
  settingsOrReader: SpectralGateSettings | SpectralGateSettingsReader,
  state: SpectralGateState = createSpectralGateState(),
): SpectralGateState {
  let readSettings: SpectralGateSettingsReader | null = null;
  let staticSettings: NormalizedSpectralGateSettings | null = null;
  if (typeof settingsOrReader === 'function') {
    readSettings = settingsOrReader;
  } else {
    staticSettings = normalizeSpectralGateSettings(settingsOrReader, input.sampleRate);
  }
  const fallbackChannel = input.numberOfChannels - 1;

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    const channelState = getChannelState(state, channel);

    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const dry = source[sampleIndex] ?? 0;
      const time = sampleIndex / input.sampleRate;
      const settings = staticSettings ??
        normalizeSpectralGateSettings(readSettings!(time), input.sampleRate);

      if (settings.mix <= 0.0001 || settings.reductionDb <= 0.0001) {
        target[sampleIndex] = dry;
        continue;
      }

      channelState.lowState += settings.lowAlpha * (dry - channelState.lowState);
      channelState.highLowState += settings.highAlpha * (dry - channelState.highLowState);

      const low = channelState.lowState;
      const mid = channelState.highLowState - low;
      const high = dry - channelState.highLowState;
      const wet =
        low * calculateBandGain(low, 0, settings, channelState) +
        mid * calculateBandGain(mid, 1, settings, channelState) +
        high * calculateBandGain(high, 2, settings, channelState);

      target[sampleIndex] = dry * (1 - settings.mix) + wet * settings.mix;
    }
  }

  return state;
}
