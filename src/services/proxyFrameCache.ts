// Proxy frame cache - loads and caches proxy image frames for fast playback

import { Logger } from './logger';
import { projectFileService } from './projectFileService';
import {
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from './project/mediaSourceResolver';

const log = Logger.create('ProxyFrameCache');
import { fileSystemService } from './fileSystemService';
import { useMediaStore } from '../stores/mediaStore';
import { clampAudioPan, dbToLinearGain, finiteNumber } from '../engine/audio/audioMath';
import {
  createSpectralGateState,
  processSpectralGateBlock,
  type SpectralGateState,
} from '../engine/audio/spectralGateProcessor';
import {
  createAudioEqDynamicRuntimeState,
  createSingleBandAudioEqParams,
  processAudioEqChannels,
  type AudioEqDynamicRuntimeState,
} from '../engine/audio/eq/AudioEqDynamic';
import type { AudioRouteEffectSettings, LiveAudioRouteProcessor } from './audio/audioGraphRouteSettings';
import type { AudioDynamicsReductionSnapshot, AudioMeterSnapshot } from '../types';
import { calculateAudioMeterSnapshot } from './audio/audioMetering';

// Cache settings - tuned for fast scrubbing
const MAX_CACHE_SIZE = 900; // 30 seconds at 30fps - larger cache for scrubbing
const PRELOAD_AHEAD_FRAMES = 60; // 2 seconds ahead for playback
const PRELOAD_BEHIND_FRAMES = 30; // 1 second behind for reverse scrubbing
const PARALLEL_LOAD_COUNT = 16; // More parallel loads for faster preload
const SCRUB_PRELOAD_RANGE = 90; // 3 seconds around scrub position
const SCRUB_TELEPORT_SECONDS = 2; // Large jumps should abandon stale queued scrub preloads
const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const HUM_NOTCH_MAX_HARMONICS = 8;

// Frame cache entry
interface CachedFrame {
  mediaFileId: string;
  frameIndex: number;
  image: HTMLImageElement;
  timestamp: number; // For LRU eviction
}

export interface ProxyCachedFrame {
  frameIndex: number;
  image: HTMLImageElement;
}

interface ScrubAudioOptions {
  volume?: number;
  eqGains?: number[];
  pan?: number;
  processors?: LiveAudioRouteProcessor[];
  masterRoute?: AudioRouteEffectSettings;
}

interface ScrubProcessorNode {
  id: string;
  type: LiveAudioRouteProcessor['type'];
  nodes: AudioNode[];
  inputNode?: AudioNode;
  outputNode?: AudioNode;
  panner?: StereoPannerNode;
  filter?: BiquadFilterNode;
  filters?: BiquadFilterNode[];
  compressor?: DynamicsCompressorNode;
  makeupGain?: GainNode;
  dryGain?: GainNode;
  wetGain?: GainNode;
  scriptProcessor?: ScriptProcessorNode;
  sampleProcessor?: LiveAudioRouteProcessor;
  spectralGateState?: SpectralGateState;
  dynamicEqState?: AudioEqDynamicRuntimeState;
  gainByChannel?: number[];
  envelopeByChannel?: number[];
  gainReductionDb?: number;
}

function clampScrubFrequency(ctx: BaseAudioContext, value: number): number {
  const nyquist = Math.max(20, ctx.sampleRate / 2 - 1);
  return Math.max(10, Math.min(nyquist, finiteNumber(value, 1000)));
}

function scrubProcessorSignature(processors: readonly LiveAudioRouteProcessor[] = []): string {
  return processors.map(processor => `${processor.id}:${processor.type}`).join('|');
}

function normalizeScrubDynamicsReductionDb(rawReduction: number): number {
  if (!Number.isFinite(rawReduction)) return 0;
  const reduction = rawReduction < 0 ? -rawReduction : rawReduction;
  return Math.max(0, Math.min(60, reduction));
}

function scrubLimiterReductionDb(inputLinear: number, outputLinear: number): number {
  if (inputLinear <= 0 || outputLinear <= 0 || outputLinear >= inputLinear) return 0;
  return normalizeScrubDynamicsReductionDb(20 * Math.log10(inputLinear / outputLinear));
}

function updateScrubProcessorNode(
  ctx: BaseAudioContext,
  node: ScrubProcessorNode,
  processor: LiveAudioRouteProcessor,
): void {
  if (processor.type === 'pan' && node.panner) {
    node.panner.pan.value = clampAudioPan(finiteNumber(processor.pan, 0));
    return;
  }

  if (processor.type === 'parametric-eq' && node.filter) {
    node.filter.type = 'peaking';
    node.filter.frequency.value = clampScrubFrequency(ctx, processor.frequencyHz);
    node.filter.Q.value = Math.max(0.0001, Math.min(30, finiteNumber(processor.q, 1)));
    node.filter.gain.value = Math.max(-48, Math.min(48, finiteNumber(processor.gainDb, 0)));
    return;
  }

  if ((processor.type === 'high-pass' || processor.type === 'low-pass') && node.filter) {
    node.filter.type = processor.type === 'high-pass' ? 'highpass' : 'lowpass';
    node.filter.frequency.value = clampScrubFrequency(ctx, processor.frequencyHz);
    node.filter.Q.value = Math.max(0.0001, Math.min(30, finiteNumber(processor.q, 0.707)));
    return;
  }

  if (processor.type === 'biquad-filter' && node.filter) {
    node.filter.type = processor.filterType;
    node.filter.frequency.value = clampScrubFrequency(ctx, processor.frequencyHz);
    node.filter.Q.value = Math.max(0.0001, Math.min(30, finiteNumber(processor.q, 0.707)));
    node.filter.gain.value = Math.max(-48, Math.min(48, finiteNumber(processor.gainDb, 0)));
    return;
  }

  if (processor.type === 'hum-notch' && node.filters && node.dryGain && node.wetGain) {
    const nyquist = Math.max(20, ctx.sampleRate / 2 - 1);
    const baseFrequency = Math.max(20, Math.min(nyquist, finiteNumber(processor.frequencyHz, 50)));
    const q = Math.max(1, Math.min(80, finiteNumber(processor.q, 30)));
    const harmonicCount = Math.max(1, Math.min(HUM_NOTCH_MAX_HARMONICS, Math.round(finiteNumber(processor.harmonics, 2))));
    const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 1)));
    node.dryGain.gain.value = 1 - mix;
    node.wetGain.gain.value = mix;
    node.filters.forEach((filter, index) => {
      const harmonic = index + 1;
      const frequency = baseFrequency * harmonic;
      if (harmonic <= harmonicCount && frequency < nyquist) {
        filter.type = 'notch';
        filter.frequency.value = Math.max(20, Math.min(nyquist, frequency));
        filter.Q.value = q;
      } else {
        filter.type = 'peaking';
        filter.frequency.value = Math.min(nyquist, 1000);
        filter.Q.value = 0.707;
        filter.gain.value = 0;
      }
    });
    return;
  }

  if (processor.type === 'compressor' && node.compressor) {
    node.compressor.threshold.value = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, 0)));
    node.compressor.ratio.value = Math.max(1, Math.min(20, finiteNumber(processor.ratio, 1)));
    node.compressor.knee.value = Math.max(0, Math.min(40, finiteNumber(processor.kneeDb, 0)));
    node.compressor.attack.value = Math.max(0, Math.min(1, finiteNumber(processor.attackMs, 10) / 1000));
    node.compressor.release.value = Math.max(0.001, Math.min(1, finiteNumber(processor.releaseMs, 120) / 1000));
    if (node.makeupGain) {
      node.makeupGain.gain.value = Math.max(0, Math.min(4, dbToLinearGain(processor.makeupGainDb)));
    }
    return;
  }

  if (
    (
      processor.type === 'limiter' ||
      processor.type === 'noise-gate' ||
      processor.type === 'expander' ||
      processor.type === 'de-click' ||
      processor.type === 'noise-reduction' ||
      processor.type === 'spectral-gate' ||
      processor.type === 'dynamic-eq-band' ||
      processor.type === 'saturation' ||
      processor.type === 'polarity-invert' ||
      processor.type === 'mono-sum' ||
      processor.type === 'channel-swap' ||
      processor.type === 'stereo-split'
    ) &&
    node.scriptProcessor
  ) {
    node.sampleProcessor = processor;
  }
}

function copyScrubInputToOutput(input: AudioBuffer, output: AudioBuffer): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    output.getChannelData(channel).set(source);
  }
}

function processScrubLimiterFrame(
  node: ScrubProcessorNode,
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'limiter' }>,
): void {
  const ceiling = Math.max(0.000001, dbToLinearGain(processor.ceilingDb));
  const inputGain = dbToLinearGain(processor.inputGainDb);
  const fallbackChannel = input.numberOfChannels - 1;
  let maxReductionDb = 0;

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const driven = (source[sampleIndex] ?? 0) * inputGain;
      const limited = Math.max(-ceiling, Math.min(ceiling, driven));
      target[sampleIndex] = limited;
      maxReductionDb = Math.max(maxReductionDb, scrubLimiterReductionDb(Math.abs(driven), Math.abs(limited)));
    }
  }

  node.gainReductionDb = maxReductionDb;
}

function processScrubNoiseGateFrame(
  node: ScrubProcessorNode,
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'noise-gate' }>,
): void {
  const threshold = dbToLinearGain(processor.thresholdDb);
  const floorGain = dbToLinearGain(processor.floorDb);
  const attackMs = Math.max(0.001, finiteNumber(processor.attackMs, 2));
  const releaseMs = Math.max(0.001, finiteNumber(processor.releaseMs, 80));
  const attackCoefficient = Math.exp(-1 / (input.sampleRate * attackMs / 1000));
  const releaseCoefficient = Math.exp(-1 / (input.sampleRate * releaseMs / 1000));
  const fallbackChannel = input.numberOfChannels - 1;
  const gainByChannel = node.gainByChannel ?? [];
  let maxReductionDb = 0;

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    let gain = gainByChannel[channel] ?? 1;
    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const sample = source[sampleIndex] ?? 0;
      const targetGain = Math.abs(sample) >= threshold ? 1 : floorGain;
      const coefficient = targetGain > gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + coefficient * (gain - targetGain);
      target[sampleIndex] = sample * gain;
      maxReductionDb = Math.max(
        maxReductionDb,
        normalizeScrubDynamicsReductionDb(-20 * Math.log10(Math.max(0.000001, gain))),
      );
    }
    gainByChannel[channel] = gain;
  }

  node.gainByChannel = gainByChannel;
  node.gainReductionDb = maxReductionDb;
}

function calculateScrubExpanderTargetGain(sample: number, processor: Extract<LiveAudioRouteProcessor, { type: 'expander' }>): number {
  const thresholdDb = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, 0)));
  const ratio = Math.max(1, Math.min(20, finiteNumber(processor.ratio, 1)));
  const rangeDb = Math.max(0, Math.min(80, finiteNumber(processor.rangeDb, 0)));
  if (ratio <= 1.0001 || rangeDb <= 0.0001) return 1;
  const inputDb = 20 * Math.log10(Math.max(0.000001, Math.abs(sample)));
  if (inputDb >= thresholdDb) return 1;
  const reductionDb = Math.min(rangeDb, (thresholdDb - inputDb) * (ratio - 1));
  return dbToLinearGain(-reductionDb);
}

function processScrubExpanderFrame(
  node: ScrubProcessorNode,
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'expander' }>,
): void {
  const attackMs = Math.max(0.001, finiteNumber(processor.attackMs, 2));
  const releaseMs = Math.max(0.001, finiteNumber(processor.releaseMs, 120));
  const attackCoefficient = Math.exp(-1 / (input.sampleRate * attackMs / 1000));
  const releaseCoefficient = Math.exp(-1 / (input.sampleRate * releaseMs / 1000));
  const fallbackChannel = input.numberOfChannels - 1;
  const gainByChannel = node.gainByChannel ?? [];
  let maxReductionDb = 0;

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    let gain = gainByChannel[channel] ?? 1;
    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const sample = source[sampleIndex] ?? 0;
      const targetGain = calculateScrubExpanderTargetGain(sample, processor);
      const coefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + coefficient * (gain - targetGain);
      target[sampleIndex] = sample * gain;
      maxReductionDb = Math.max(maxReductionDb, normalizeScrubDynamicsReductionDb(-20 * Math.log10(Math.max(0.000001, gain))));
    }
    gainByChannel[channel] = gain;
  }

  node.gainByChannel = gainByChannel;
  node.gainReductionDb = maxReductionDb;
}

function calculateScrubNoiseReductionTargetGain(
  envelope: number,
  processor: Extract<LiveAudioRouteProcessor, { type: 'noise-reduction' }>,
): number {
  const thresholdDb = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, -60)));
  const reductionDb = Math.max(0, Math.min(60, finiteNumber(processor.reductionDb, 0)));
  const sensitivity = Math.max(0.1, Math.min(4, finiteNumber(processor.sensitivity, 1)));
  if (reductionDb <= 0.0001) return 1;
  const envelopeDb = 20 * Math.log10(Math.max(0.000001, envelope));
  if (envelopeDb >= thresholdDb) return 1;
  const reductionRatio = Math.max(0, Math.min(1, ((thresholdDb - envelopeDb) / 48) * sensitivity));
  return dbToLinearGain(-reductionDb * reductionRatio);
}

function processScrubNoiseReductionFrame(
  node: ScrubProcessorNode,
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'noise-reduction' }>,
): void {
  const attackMs = Math.max(0.001, finiteNumber(processor.attackMs, 5));
  const releaseMs = Math.max(0.001, finiteNumber(processor.releaseMs, 160));
  const attackCoefficient = Math.exp(-1 / (input.sampleRate * attackMs / 1000));
  const releaseCoefficient = Math.exp(-1 / (input.sampleRate * releaseMs / 1000));
  const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
  const fallbackChannel = input.numberOfChannels - 1;
  const gainByChannel = node.gainByChannel ?? [];
  const envelopeByChannel = node.envelopeByChannel ?? [];

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    let gain = gainByChannel[channel] ?? 1;
    let envelope = envelopeByChannel[channel] ?? 0;
    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const dry = source[sampleIndex] ?? 0;
      const amplitude = Math.abs(dry);
      const envelopeCoefficient = amplitude > envelope ? attackCoefficient : releaseCoefficient;
      envelope = amplitude + envelopeCoefficient * (envelope - amplitude);
      const targetGain = calculateScrubNoiseReductionTargetGain(envelope, processor);
      const gainCoefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + gainCoefficient * (gain - targetGain);
      target[sampleIndex] = dry * (1 - mix) + dry * gain * mix;
    }
    gainByChannel[channel] = gain;
    envelopeByChannel[channel] = envelope;
  }

  node.gainByChannel = gainByChannel;
  node.envelopeByChannel = envelopeByChannel;
  node.gainReductionDb = 0;
}

function processScrubSpectralGateFrame(
  node: ScrubProcessorNode,
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'spectral-gate' }>,
): void {
  node.spectralGateState = processSpectralGateBlock(
    input,
    output,
    processor,
    node.spectralGateState ?? createSpectralGateState(),
  );
  node.gainReductionDb = 0;
}

function processScrubSaturationFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'saturation' }>,
): void {
  const driveDb = Math.max(0, Math.min(48, finiteNumber(processor.driveDb, 0)));
  const drive = dbToLinearGain(driveDb);
  const normalizer = driveDb <= 0.001 ? 1 : Math.tanh(drive) || 1;
  const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
  const cutoff = Math.max(20, Math.min(input.sampleRate / 2 - 1, finiteNumber(processor.toneHz, 16000)));
  const toneAlpha = 1 - Math.exp(-2 * Math.PI * cutoff / input.sampleRate);
  const fallbackChannel = input.numberOfChannels - 1;

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    let toneState = 0;

    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const dry = source[sampleIndex] ?? 0;
      const saturated = driveDb <= 0.001 ? dry : Math.tanh(dry * drive) / normalizer;
      toneState += toneAlpha * (saturated - toneState);
      target[sampleIndex] = Math.max(-1, Math.min(1, dry * (1 - mix) + toneState * mix));
    }
  }
}

function processScrubPolarityInvertFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'polarity-invert' }>,
): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    const invert =
      processor.channelMode === 'all' ||
      (processor.channelMode === 'left' && channel === 0) ||
      (processor.channelMode === 'right' && channel === 1);

    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const sample = source[sampleIndex] ?? 0;
      target[sampleIndex] = invert ? -sample : sample;
    }
  }
}

function processScrubMonoSumFrame(input: AudioBuffer, output: AudioBuffer): void {
  const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
  for (let sampleIndex = 0; sampleIndex < output.length; sampleIndex += 1) {
    let sum = 0;
    for (const source of sourceChannels) {
      sum += source[sampleIndex] ?? 0;
    }
    const mono = sourceChannels.length > 0 ? sum / sourceChannels.length : 0;
    for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
      output.getChannelData(channel)[sampleIndex] = mono;
    }
  }
}

function processScrubChannelSwapFrame(input: AudioBuffer, output: AudioBuffer): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const sourceChannel = input.numberOfChannels >= 2
      ? channel === 0 ? 1 : channel === 1 ? 0 : channel
      : channel;
    const source = input.getChannelData(Math.max(0, Math.min(sourceChannel, fallbackChannel)));
    output.getChannelData(channel).set(source);
  }
}

function processScrubDeClickFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'de-click' }>,
): void {
  const fallbackChannel = input.numberOfChannels - 1;
  const threshold = Math.max(0.01, Math.min(1, finiteNumber(processor.threshold, 0.35)));
  const ratio = Math.max(1, finiteNumber(processor.ratio, 4));
  const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 1)));

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    if (target.length <= 2) {
      target.set(source);
      continue;
    }
    target[0] = source[0] ?? 0;
    target[target.length - 1] = source[target.length - 1] ?? 0;

    for (let sampleIndex = 1; sampleIndex < target.length - 1; sampleIndex += 1) {
      const previous = source[sampleIndex - 1] ?? 0;
      const dry = source[sampleIndex] ?? 0;
      const next = source[sampleIndex + 1] ?? 0;
      const prediction = (previous + next) / 2;
      const residual = Math.abs(dry - prediction);
      const neighborEnergy = (Math.abs(previous) + Math.abs(next)) / 2;
      const click = residual >= threshold && residual >= neighborEnergy * ratio;
      target[sampleIndex] = click ? dry * (1 - mix) + prediction * mix : dry;
    }
  }
}

function processScrubStereoSplitFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'stereo-split' }>,
): void {
  const sourceChannel = Math.max(
    0,
    Math.min(input.numberOfChannels - 1, Math.round(finiteNumber(processor.sourceChannel, 0))),
  );
  const source = input.getChannelData(sourceChannel);
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    output.getChannelData(channel).set(source);
  }
}

function attachScrubSampleProcessor(node: ScrubProcessorNode): void {
  const scriptProcessor = node.scriptProcessor;
  if (!scriptProcessor) return;

  scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
    const processor = node.sampleProcessor;
    if (processor?.type === 'limiter') {
      processScrubLimiterFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor?.type === 'noise-gate') {
      processScrubNoiseGateFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor?.type === 'expander') {
      processScrubExpanderFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor?.type === 'de-click') {
      processScrubDeClickFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    if (processor?.type === 'noise-reduction') {
      processScrubNoiseReductionFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor?.type === 'spectral-gate') {
      processScrubSpectralGateFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor?.type === 'dynamic-eq-band') {
      processScrubDynamicEqBandFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor?.type === 'saturation') {
      processScrubSaturationFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    if (processor?.type === 'polarity-invert') {
      processScrubPolarityInvertFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    if (processor?.type === 'mono-sum') {
      processScrubMonoSumFrame(event.inputBuffer, event.outputBuffer);
      node.gainReductionDb = 0;
      return;
    }

    if (processor?.type === 'channel-swap') {
      processScrubChannelSwapFrame(event.inputBuffer, event.outputBuffer);
      node.gainReductionDb = 0;
      return;
    }

    if (processor?.type === 'stereo-split') {
      processScrubStereoSplitFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    copyScrubInputToOutput(event.inputBuffer, event.outputBuffer);
    node.gainReductionDb = 0;
  };
}

function processScrubDynamicEqBandFrame(
  node: ScrubProcessorNode,
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'dynamic-eq-band' }>,
): void {
  node.dynamicEqState ??= createAudioEqDynamicRuntimeState();
  const channels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
  const result = processAudioEqChannels(channels, createSingleBandAudioEqParams(processor.band), {
    sampleRate: input.sampleRate,
    state: node.dynamicEqState,
  });
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    output.getChannelData(channel).set(result.channels[channel] ?? channels[channel]);
  }
  node.gainReductionDb = result.telemetry.reduce(
    (maxReduction, band) => Math.max(maxReduction, band.maxGainReductionDb),
    0,
  );
}

function reconnectScrubCustomProcessor(node: ScrubProcessorNode): void {
  if (
    node.type === 'hum-notch' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.wetGain &&
    node.filters?.length
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    let wetTail: AudioNode = node.inputNode;
    for (const filter of node.filters) {
      wetTail.connect(filter);
      wetTail = filter;
    }
    wetTail.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
  }
}

class ProxyFrameCache {
  private cache: Map<string, CachedFrame> = new Map();
  private loadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();
  private preloadQueue: string[] = [];
  private isPreloading = false;

  // Audio proxy cache
  private audioCache: Map<string, HTMLAudioElement> = new Map();
  private audioLoadingPromises: Map<string, Promise<HTMLAudioElement | null>> = new Map();

  // Audio buffer cache for instant scrubbing (Web Audio API)
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private audioBufferFailed: Set<string> = new Set(); // Track files with no audio
  private audioContext: AudioContext | null = null;
  private scrubGain: GainNode | null = null;
  private scrubAnalyser: AnalyserNode | null = null;
  private scrubStereoSplitter: ChannelSplitterNode | null = null;
  private scrubLeftAnalyser: AnalyserNode | null = null;
  private scrubRightAnalyser: AnalyserNode | null = null;
  private scrubMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubLeftMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubRightMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubFrequencyBuffer: Float32Array<ArrayBuffer> | null = null;

  // Get cache key
  private getKey(mediaFileId: string, frameIndex: number): string {
    return `${mediaFileId}_${frameIndex}`;
  }

  // Synchronously get a frame if it's already in memory cache
  // Also triggers preloading of upcoming frames (even if current frame not cached)
  getCachedFrame(mediaFileId: string, frameIndex: number, fps: number = 30): HTMLImageElement | null {
    const key = this.getKey(mediaFileId, frameIndex);
    const cached = this.cache.get(key);

    // ALWAYS trigger preloading, even if current frame isn't cached
    // This ensures nested composition frames get preloaded when playhead enters them
    this.schedulePreload(mediaFileId, frameIndex, fps);

    if (cached) {
      cached.timestamp = Date.now(); // Update for LRU
      this.cacheHits++;
      return cached.image;
    }
    this.cacheMisses++;
    return null;
  }

  // Get nearest cached frame for scrubbing fallback
  // Returns the closest frame within maxDistance frames
  // Searches in scrub direction first for smoother scrubbing
  getNearestCachedFrame(mediaFileId: string, frameIndex: number, maxDistance: number = 30): HTMLImageElement | null {
    return this.getNearestCachedFrameEntry(mediaFileId, frameIndex, maxDistance)?.image ?? null;
  }

  getNearestCachedFrameEntry(
    mediaFileId: string,
    frameIndex: number,
    maxDistance: number = 30
  ): ProxyCachedFrame | null {
    // Check exact frame first
    const exactKey = this.getKey(mediaFileId, frameIndex);
    const exact = this.cache.get(exactKey);
    if (exact) {
      exact.timestamp = Date.now();
      return { frameIndex: exact.frameIndex, image: exact.image };
    }

    // Search in scrub direction first for visual continuity
    const searchForward = this.scrubDirection >= 0;

    for (let d = 1; d <= maxDistance; d++) {
      // Search primary direction first
      const primaryOffset = searchForward ? d : -d;
      const primaryFrame = frameIndex + primaryOffset;
      if (primaryFrame >= 0) {
        const primaryKey = this.getKey(mediaFileId, primaryFrame);
        const primary = this.cache.get(primaryKey);
        if (primary) {
          primary.timestamp = Date.now();
          return { frameIndex: primary.frameIndex, image: primary.image };
        }
      }

      // Then search opposite direction
      const secondaryOffset = searchForward ? -d : d;
      const secondaryFrame = frameIndex + secondaryOffset;
      if (secondaryFrame >= 0) {
        const secondaryKey = this.getKey(mediaFileId, secondaryFrame);
        const secondary = this.cache.get(secondaryKey);
        if (secondary) {
          secondary.timestamp = Date.now();
          return { frameIndex: secondary.frameIndex, image: secondary.image };
        }
      }
    }

    return null;
  }

  // Get a frame from cache or load it
  async getFrame(mediaFileId: string, time: number, fps: number = 30): Promise<HTMLImageElement | null> {
    const frameIndex = Math.floor(time * fps);
    const key = this.getKey(mediaFileId, frameIndex);

    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      cached.timestamp = Date.now(); // Update for LRU
      return cached.image;
    }

    // Check if already loading
    const loadingPromise = this.loadingPromises.get(key);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Load from IndexedDB
    const promise = this.loadFrame(mediaFileId, frameIndex);
    this.loadingPromises.set(key, promise);

    try {
      const image = await promise;
      if (image) {
        this.addToCache(mediaFileId, frameIndex, image);
        // Trigger preload of upcoming frames
        this.schedulePreload(mediaFileId, frameIndex, fps);
      }
      return image;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  // Load a single frame - ONLY from project folder (no browser cache)
  private async loadFrame(mediaFileId: string, frameIndex: number): Promise<HTMLImageElement | null> {
    try {
      let blob: Blob | null = null;

      // Get the media file to find its fileHash (used for proxy folder naming)
      const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
      const storageKey = mediaFile?.fileHash || mediaFileId;

      // Debug logging
      if (frameIndex === 0) {
        log.debug(`Loading frame 0 for: ${mediaFile?.name}`);
        log.debug(`storageKey: ${storageKey}, projectOpen: ${projectFileService.isProjectOpen()}, proxyStatus: ${mediaFile?.proxyStatus}`);
      }

      // Load from project folder ONLY (no IndexedDB fallback)
      if (projectFileService.isProjectOpen()) {
        blob = await projectFileService.getProxyFrame(storageKey, frameIndex);
        if (frameIndex === 0) {
          log.debug(`Frame 0 blob: ${blob ? `${blob.size} bytes` : 'null'}`);
        }
      }

      if (!blob) return null;

      // Create image from blob
      const url = URL.createObjectURL(blob);
      const image = new Image();

      return new Promise((resolve) => {
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        image.src = url;
      });
    } catch (e) {
      log.warn('Failed to load frame', e);
      return null;
    }
  }

  // Add frame to cache
  private addToCache(mediaFileId: string, frameIndex: number, image: HTMLImageElement) {
    const key = this.getKey(mediaFileId, frameIndex);

    // Evict old frames if cache is full
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    this.cache.set(key, {
      mediaFileId,
      frameIndex,
      image,
      timestamp: Date.now(),
    });
  }

  // Evict oldest frame from cache (LRU)
  private evictOldest() {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  // Scrub tracking for smart preloading
  private lastScrubFrame = -1;
  private scrubDirection = 0; // -1 = backward, 0 = stopped, 1 = forward
  private isScrubbing = false;
  private scrubPreloadQueueDrops = 0;

  private removeQueuedPreloadsForMedia(mediaFileId: string): number {
    const prefix = `${mediaFileId}_`;
    const before = this.preloadQueue.length;
    this.preloadQueue = this.preloadQueue.filter((key) => !key.startsWith(prefix));
    return before - this.preloadQueue.length;
  }

  private parsePreloadKey(key: string): { mediaFileId: string; frameIndex: number } | null {
    const separatorIndex = key.lastIndexOf('_');
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      return null;
    }

    const frameIndex = Number.parseInt(key.slice(separatorIndex + 1), 10);
    if (!Number.isFinite(frameIndex)) {
      return null;
    }

    return {
      mediaFileId: key.slice(0, separatorIndex),
      frameIndex,
    };
  }

  // Schedule preloading of frames around current position (bidirectional)
  private schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number) {
    // Detect scrub direction
    if (this.lastScrubFrame >= 0) {
      const delta = currentFrameIndex - this.lastScrubFrame;
      const teleportThresholdFrames = Math.max(
        SCRUB_PRELOAD_RANGE,
        Math.floor(Math.max(1, fps) * SCRUB_TELEPORT_SECONDS)
      );
      if (Math.abs(delta) >= teleportThresholdFrames) {
        const dropped = this.removeQueuedPreloadsForMedia(mediaFileId);
        if (dropped > 0) {
          this.scrubPreloadQueueDrops += dropped;
        }
        this.scrubDirection = delta > 0 ? 1 : -1;
        this.isScrubbing = true;
      } else if (Math.abs(delta) > 0) {
        this.scrubDirection = delta > 0 ? 1 : -1;
        this.isScrubbing = true;
      }
    }
    this.lastScrubFrame = currentFrameIndex;

    // Calculate preload range based on scrubbing state
    const preloadAhead = this.isScrubbing ? SCRUB_PRELOAD_RANGE : PRELOAD_AHEAD_FRAMES;
    const preloadBehind = this.isScrubbing ? SCRUB_PRELOAD_RANGE : PRELOAD_BEHIND_FRAMES;

    // Priority queue: current frame first, then direction-based loading
    const framesToPreload: number[] = [currentFrameIndex];

    // Add frames in scrub direction first (higher priority)
    if (this.scrubDirection >= 0) {
      // Forward or stopped: prioritize ahead
      for (let i = 1; i <= preloadAhead; i++) {
        framesToPreload.push(currentFrameIndex + i);
      }
      for (let i = 1; i <= preloadBehind; i++) {
        if (currentFrameIndex - i >= 0) {
          framesToPreload.push(currentFrameIndex - i);
        }
      }
    } else {
      // Backward scrubbing: prioritize behind
      for (let i = 1; i <= preloadBehind; i++) {
        if (currentFrameIndex - i >= 0) {
          framesToPreload.push(currentFrameIndex - i);
        }
      }
      for (let i = 1; i <= preloadAhead; i++) {
        framesToPreload.push(currentFrameIndex + i);
      }
    }

    // Add to preload queue
    for (let i = 0; i < framesToPreload.length; i++) {
      const frameIndex = framesToPreload[i];
      if (frameIndex < 0) continue;

      const key = this.getKey(mediaFileId, frameIndex);

      // Skip if already cached or in queue
      if (!this.cache.has(key) && !this.preloadQueue.includes(key)) {
        // Insert current frame at front of queue for priority loading
        if (i === 0) {
          this.preloadQueue.unshift(key);
        } else {
          this.preloadQueue.push(key);
        }
      }
    }

    // Start preloading if not already
    if (!this.isPreloading) {
      this.processPreloadQueue();
    }
  }

  // Call this when scrubbing stops to reset state
  resetScrubState(): void {
    this.isScrubbing = false;
    this.scrubDirection = 0;
    this.lastScrubFrame = -1;
  }

  // Process preload queue with parallel loading for speed
  private async processPreloadQueue() {
    this.isPreloading = true;

    while (this.preloadQueue.length > 0) {
      // Load multiple frames in parallel for faster preloading
      const batch: string[] = [];
      while (batch.length < PARALLEL_LOAD_COUNT && this.preloadQueue.length > 0) {
        const key = this.preloadQueue.shift();
        if (key && !this.cache.has(key)) {
          batch.push(key);
        }
      }

      if (batch.length === 0) continue;

      // Load batch in parallel
      const loadPromises = batch.map(async (key) => {
        const parsed = this.parsePreloadKey(key);
        if (!parsed) {
          return { key, success: false };
        }

        const image = await this.loadFrame(parsed.mediaFileId, parsed.frameIndex);
        if (image) {
          this.addToCache(parsed.mediaFileId, parsed.frameIndex, image);
        }
        return { key, success: !!image };
      });

      await Promise.all(loadPromises);

      // Brief yield to main thread between batches
      await new Promise((r) => setTimeout(r, 0));
    }

    this.isPreloading = false;
  }

  // ============================================
  // AUDIO PROXY METHODS
  // ============================================

  /**
   * Get cached audio proxy element, or load it if not cached
   * Returns null if no audio proxy exists
   */
  async getAudioProxy(mediaFileId: string): Promise<HTMLAudioElement | null> {
    // Check cache first
    const cached = this.audioCache.get(mediaFileId);
    if (cached) {
      return cached;
    }

    // Check if already loading
    const existingPromise = this.audioLoadingPromises.get(mediaFileId);
    if (existingPromise) {
      return existingPromise;
    }

    // Start loading
    const loadPromise = this.loadAudioProxy(mediaFileId);
    this.audioLoadingPromises.set(mediaFileId, loadPromise);

    try {
      const audio = await loadPromise;
      if (audio) {
        this.audioCache.set(mediaFileId, audio);
      }
      return audio;
    } finally {
      this.audioLoadingPromises.delete(mediaFileId);
    }
  }

  /**
   * Get cached audio proxy synchronously (returns null if not yet loaded)
   */
  getCachedAudioProxy(mediaFileId: string): HTMLAudioElement | null {
    return this.audioCache.get(mediaFileId) || null;
  }

  /**
   * Preload audio proxy for a media file
   */
  async preloadAudioProxy(mediaFileId: string): Promise<void> {
    // Just call getAudioProxy which handles caching
    await this.getAudioProxy(mediaFileId);
  }

  /**
   * Load audio proxy from project folder
   */
  private async loadAudioProxy(mediaFileId: string): Promise<HTMLAudioElement | null> {
    try {
      // Get storage key (prefer fileHash for deduplication)
      const mediaStore = useMediaStore.getState();
      const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
      const storageKey = mediaFile?.fileHash || mediaFileId;

      // Load audio file from project folder
      const audioFile = await projectFileService.getProxyAudio(storageKey);
      if (!audioFile) {
        return null;
      }

      // Create audio element with object URL
      const audio = new Audio();
      audio.src = URL.createObjectURL(audioFile);
      audio.preload = 'auto';

      // Wait for audio to be ready
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
          reject(new Error('Failed to load audio proxy'));
        };
        audio.addEventListener('canplaythrough', onCanPlay);
        audio.addEventListener('error', onError);
        // Start loading
        audio.load();
      });

      log.info(`Audio proxy loaded for ${mediaFileId}`);
      return audio;
    } catch (e) {
      log.warn(`Failed to load audio proxy for ${mediaFileId}`, e);
      return null;
    }
  }

  // ============================================
  // VARISPEED AUDIO SCRUBBING (Web Audio API)
  // Like Premiere/Resolve: continuous audio that follows scrub speed
  // ============================================

  // Varispeed scrubbing state
  private scrubSource: AudioBufferSourceNode | null = null;
  private scrubSourceGain: GainNode | null = null;
  private scrubPanNode: StereoPannerNode | null = null;
  private scrubEqFilters: BiquadFilterNode[] = [];
  private scrubProcessorNodes: ScrubProcessorNode[] = [];
  private scrubProcessorSignature = '';
  private scrubStartTime = 0; // AudioContext time when scrub started
  private scrubStartPosition = 0; // Audio position when scrub started
  private scrubCurrentMediaId: string | null = null;
  private scrubLastPosition = 0;
  private scrubLastTime = 0;
  private scrubIsActive = false;

  /**
   * Get or create AudioContext for scrubbing
   */
  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.scrubGain = this.audioContext.createGain();
      this.scrubAnalyser = this.audioContext.createAnalyser();
      this.scrubAnalyser.fftSize = 1024;
      this.scrubAnalyser.smoothingTimeConstant = 0.2;
      this.scrubMeterBuffer = new Float32Array(this.scrubAnalyser.fftSize);
      this.scrubAnalyser.connect(this.scrubGain);
      this.scrubGain.connect(this.audioContext.destination);
      this.scrubGain.gain.value = 1;
      log.debug(`AudioContext created, state: ${this.audioContext.state}`);
    }
    return this.audioContext;
  }

  /**
   * Ensure AudioContext is running - MUST be called from a user gesture (mousedown/click).
   * Chrome's autoplay policy requires resume() from a user gesture to unlock audio.
   * IMPORTANT: Do NOT close/replace the AudioContext here - that kills pending decodeAudioData()
   * calls which permanently blacklists audio files. Just resume() - Chrome honors it from gestures.
   */
  ensureAudioContextResumed(): void {
    if (!this.audioContext) {
      // Create fresh context in user gesture → starts "running" automatically
      this.getAudioContext();
      log.debug(`AudioContext created in user gesture, state: ${this.audioContext!.state}`);
      return;
    }

    if (this.audioContext.state === 'suspended') {
      // resume() from a user gesture is always honored by Chrome
      // Don't check synchronously after - resume() is async but Chrome will process it
      this.audioContext.resume().then(() => {
        log.debug(`AudioContext resumed: ${this.audioContext?.state}`);
      }).catch(() => {
        log.warn('AudioContext resume failed');
      });
    }
  }

  /**
   * Get AudioBuffer for a media file (decode on first request)
   * Works with BOTH proxy audio AND original video files
   */
  async getAudioBuffer(mediaFileId: string, videoElementSrc?: string): Promise<AudioBuffer | null> {
    // Check cache
    const cached = this.audioBufferCache.get(mediaFileId);
    if (cached) return cached;

    // Skip files that have no audio (failed decoding = audio doesn't exist)
    if (this.audioBufferFailed.has(mediaFileId)) {
      return null;
    }

    // Check if already loading
    if (this.audioBufferLoading.has(mediaFileId)) {
      return null; // Loading in progress
    }

    // Cooldown for "source not found" - retry after 3 seconds (source may become available)
    const lastAttempt = this.audioBufferRetryTime.get(mediaFileId);
    if (lastAttempt && performance.now() - lastAttempt < 3000) {
      return null;
    }

    this.audioBufferLoading.add(mediaFileId);

    try {
      const mediaStore = useMediaStore.getState();
      const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
      const storageKey = mediaFile?.fileHash || mediaFileId;

      let arrayBuffer: ArrayBuffer | null = null;

      // Try 1: Proxy audio file (fastest, smallest)
      const audioFile = await projectFileService.getProxyAudio(storageKey);
      if (audioFile) {
        log.debug(`Loading from proxy audio: ${mediaFileId}`);
        arrayBuffer = await audioFile.arrayBuffer();
      }

      // Try 2: Project-local RAW media file
      if (!arrayBuffer) {
        const projectHandle = await getStoredProjectFileHandle(mediaFileId);
        if (projectHandle) {
          log.debug(`Loading from project RAW handle: ${mediaFileId}`);
          try {
            const file = await projectHandle.getFile();
            arrayBuffer = await file.arrayBuffer();
          } catch (e) {
            log.warn('Failed to read project RAW handle', e);
          }
        }
      }

      if (!arrayBuffer && projectFileService.isProjectOpen()) {
        for (const candidatePath of getProjectRawPathCandidates({
          mediaFileId,
          projectPath: mediaFile?.projectPath,
          filePath: mediaFile?.filePath,
          name: mediaFile?.name,
        })) {
          log.debug(`Loading from project RAW path: ${mediaFileId} (${candidatePath})`);
          try {
            const result = await projectFileService.getFileFromRaw(candidatePath);
            if (result) {
              arrayBuffer = await result.file.arrayBuffer();
              break;
            }
          } catch (e) {
            log.warn('Failed to read project RAW path', e);
          }
        }
      }

      // Try 3: Original video file URL (extract audio from video)
      if (!arrayBuffer && mediaFile?.url) {
        log.debug(`Loading from video URL: ${mediaFileId}`);
        try {
          const response = await fetch(mediaFile.url);
          arrayBuffer = await response.arrayBuffer();
        } catch (e) {
          log.warn('Failed to fetch video URL', e);
        }
      }

      // Try 4: File handle (if available)
      if (!arrayBuffer) {
        const fileHandle = fileSystemService.getFileHandle(mediaFileId);
        if (fileHandle) {
          log.debug(`Loading from file handle: ${mediaFileId}`);
          try {
            const file = await fileHandle.getFile();
            arrayBuffer = await file.arrayBuffer();
          } catch (e) {
            log.warn('Failed to read file handle', e);
          }
        }
      }

      // Try 5: Direct File object from media store (e.g. YouTube downloads)
      if (!arrayBuffer && mediaFile?.file) {
        log.debug(`Loading from File object: ${mediaFileId}`);
        try {
          arrayBuffer = await mediaFile.file.arrayBuffer();
        } catch (e) {
          log.warn('Failed to read File object', e);
        }
      }

      // Try 6: Video element's current source URL (guaranteed valid if video is playing)
      if (!arrayBuffer && videoElementSrc) {
        log.debug(`Loading from video element src: ${mediaFileId}`);
        try {
          const response = await fetch(videoElementSrc);
          arrayBuffer = await response.arrayBuffer();
        } catch (e) {
          log.warn('Failed to fetch video element src', e);
        }
      }

      if (!arrayBuffer) {
        log.warn(`No audio source found for ${mediaFileId}`);
        // Use cooldown instead of permanent failure - source may become available later
        this.audioBufferRetryTime.set(mediaFileId, performance.now());
        this.audioBufferLoading.delete(mediaFileId);
        return null;
      }

      // Decode to AudioBuffer
      const audioContext = this.getAudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0)); // Clone to avoid detached buffer

      // Cache it
      this.audioBufferCache.set(mediaFileId, audioBuffer);
      this.audioBufferLoading.delete(mediaFileId);
      this.audioBufferRetryTime.delete(mediaFileId);
      log.debug(`Decoded ${mediaFileId}: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.numberOfChannels}ch`);

      return audioBuffer;
    } catch (e) {
      this.audioBufferLoading.delete(mediaFileId);
      const errorName = e instanceof Error ? e.name : undefined;
      const errorMessage = e instanceof Error ? e.message : String(e);
      // Only permanently blacklist for actual "no audio track" decode errors (EncodingError).
      // Context-related errors (InvalidStateError from closed context) should use retry cooldown
      // so the buffer can be decoded on a new/resumed context.
      if (errorName === 'EncodingError') {
        this.audioBufferFailed.add(mediaFileId);
        log.debug(`No audio track in ${mediaFileId}`);
      } else {
        this.audioBufferRetryTime.set(mediaFileId, performance.now());
        log.debug(`Audio decode error for ${mediaFileId} (will retry): ${errorMessage}`);
      }
      return null;
    }
  }

  // Track loading state to prevent duplicate loads
  private audioBufferLoading = new Set<string>();
  // Cooldown for "source not found" retries (not permanent failure like audioBufferFailed)
  private audioBufferRetryTime = new Map<string, number>();


  /**
   * VARISPEED SCRUBBING - Call this continuously while scrubbing
   * Audio plays continuously and follows the scrub position/speed
   * Like Premiere Pro / DaVinci Resolve
   */
  playScrubAudio(
    mediaFileId: string,
    targetTime: number,
    _duration: number = 0.15,
    videoElementSrc?: string,
    options?: ScrubAudioOptions
  ): void {
    const buffer = this.audioBufferCache.get(mediaFileId);
    if (!buffer) {
      log.debug(`No AudioBuffer for ${mediaFileId} - loading...`);
      this.getAudioBuffer(mediaFileId, videoElementSrc);
      return;
    }

    // Debug: Log that varispeed is active
    if (!this.scrubIsActive) {
      log.debug(`VARISPEED starting at ${targetTime.toFixed(2)}s`);
    }

    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const scrubVolume = Math.max(0, Math.min(4, options?.volume ?? 1));
    const scrubMasterVolume = Math.max(0, Math.min(4, options?.masterRoute?.volume ?? 1));
    const scrubEqGains = options?.eqGains ?? [];
    const scrubPan = clampAudioPan(options?.pan);
    const scrubProcessors = options?.processors ?? [];
    const processorSignature = scrubProcessorSignature(scrubProcessors);
    const now = performance.now();
    const clampedTarget = Math.max(0, Math.min(targetTime, buffer.duration - 0.1));

    // Calculate scrub velocity (how fast user is scrubbing)
    const timeDelta = (now - this.scrubLastTime) / 1000; // seconds
    const posDelta = clampedTarget - this.scrubLastPosition;
    this.scrubLastPosition = clampedTarget;
    this.scrubLastTime = now;

    // Need new source if: different media, not active, or position jumped too far
    const needNewSource =
      !this.scrubIsActive ||
      this.scrubCurrentMediaId !== mediaFileId ||
      !this.scrubSource ||
      this.scrubProcessorSignature !== processorSignature;

    if (needNewSource) {
      // Stop existing source
      this.stopScrubAudio();

      this.scrubSource = ctx.createBufferSource();
      this.scrubSource.buffer = buffer;
      this.scrubSource.playbackRate.value = 1.0;
      this.attachScrubEffectChain(ctx, this.scrubSource, scrubVolume, scrubEqGains, scrubPan, scrubProcessors);
      this.scrubProcessorSignature = processorSignature;

      // Start playing from target position
      this.scrubSource.start(0, clampedTarget);
      this.scrubStartTime = ctx.currentTime;
      this.scrubStartPosition = clampedTarget;
      this.scrubCurrentMediaId = mediaFileId;
      this.scrubIsActive = true;

      // Guard: only deactivate if THIS source is still the current one
      // (onended fires asynchronously and could clobber a newer source)
      const thisSource = this.scrubSource;
      thisSource.onended = () => {
        if (this.scrubSource === thisSource) {
          this.scrubIsActive = false;
          this.scrubSource = null;
        }
      };
    } else if (this.scrubSource && timeDelta > 0.001) {
      this.updateScrubEffects(scrubVolume, scrubEqGains, scrubPan, scrubProcessors);

      // Calculate where audio SHOULD be vs where it IS
      const elapsedAudioTime = (ctx.currentTime - this.scrubStartTime) * this.scrubSource.playbackRate.value;
      const currentAudioPos = this.scrubStartPosition + elapsedAudioTime;
      const drift = clampedTarget - currentAudioPos;

      // If drift is too large (>300ms), restart at correct position
      if (Math.abs(drift) > 0.3) {
        this.stopScrubAudio();
        // Will restart on next call
        return;
      }

      // Calculate target playback rate based on scrub velocity
      // scrubSpeed = how many seconds of audio per second of real time
      const scrubSpeed = timeDelta > 0.01 ? Math.abs(posDelta) / timeDelta : 1;

      // Clamp to reasonable range and add drift correction
      const driftCorrection = drift * 2; // Gentle drift correction
      let targetRate = Math.max(0.25, Math.min(4.0, scrubSpeed + driftCorrection));

      // If scrubbing backwards, we can't play backwards, so just slow down a lot
      if (posDelta < -0.001) {
        targetRate = 0.25; // Minimum speed for backwards feel
      }

      // Smooth rate changes to avoid clicks
      const currentRate = this.scrubSource.playbackRate.value;
      const smoothedRate = currentRate + (targetRate - currentRate) * 0.3;
      this.scrubSource.playbackRate.value = Math.max(0.25, Math.min(4.0, smoothedRate));
    } else {
      this.updateScrubEffects(scrubVolume, scrubEqGains, scrubPan, scrubProcessors);
    }

    if (this.scrubGain && Math.abs(this.scrubGain.gain.value - scrubMasterVolume) > 0.001) {
      this.scrubGain.gain.value = scrubMasterVolume;
    }
  }

  /**
   * Stop scrub audio - call when scrubbing ends
   */
  stopScrubAudio(): void {
    if (this.scrubSource) {
      try {
        this.scrubSource.onended = null; // Prevent async callback from clobbering new source
        this.scrubSource.stop();
        this.scrubSource.disconnect();
      } catch { /* ignore */ }
      this.scrubSource = null;
    }
    if (this.scrubSourceGain) {
      try {
        this.scrubSourceGain.disconnect();
      } catch { /* ignore */ }
      this.scrubSourceGain = null;
    }
    if (this.scrubPanNode) {
      try {
        this.scrubPanNode.disconnect();
      } catch { /* ignore */ }
      this.scrubPanNode = null;
    }
    if (this.scrubStereoSplitter) {
      try {
        this.scrubStereoSplitter.disconnect();
      } catch { /* ignore */ }
      this.scrubStereoSplitter = null;
    }
    if (this.scrubLeftAnalyser) {
      try {
        this.scrubLeftAnalyser.disconnect();
      } catch { /* ignore */ }
      this.scrubLeftAnalyser = null;
    }
    if (this.scrubRightAnalyser) {
      try {
        this.scrubRightAnalyser.disconnect();
      } catch { /* ignore */ }
      this.scrubRightAnalyser = null;
    }
    this.scrubLeftMeterBuffer = null;
    this.scrubRightMeterBuffer = null;
    this.scrubFrequencyBuffer = null;
    for (const processor of this.scrubProcessorNodes) {
      for (const node of processor.nodes) {
        try {
          node.disconnect();
        } catch { /* ignore */ }
      }
    }
    for (const filter of this.scrubEqFilters) {
      try {
        filter.disconnect();
      } catch { /* ignore */ }
    }
    this.scrubProcessorNodes = [];
    this.scrubProcessorSignature = '';
    this.scrubEqFilters = [];
    this.scrubIsActive = false;
    this.scrubCurrentMediaId = null;

    // Also reset frame scrub tracking state
    this.resetScrubState();
  }

  getScrubMeterSnapshot(updatedAt = performance.now()): AudioMeterSnapshot | null {
    if (!this.scrubAnalyser || !this.scrubMeterBuffer || !this.scrubIsActive) return null;
    this.scrubAnalyser.getFloatTimeDomainData(this.scrubMeterBuffer);
    if (!this.scrubFrequencyBuffer || this.scrubFrequencyBuffer.length !== this.scrubAnalyser.frequencyBinCount) {
      this.scrubFrequencyBuffer = new Float32Array(this.scrubAnalyser.frequencyBinCount);
    }
    this.scrubAnalyser.getFloatFrequencyData(this.scrubFrequencyBuffer);
    const leftAnalyser = this.scrubLeftAnalyser;
    const rightAnalyser = this.scrubRightAnalyser;
    const leftMeterBuffer = this.scrubLeftMeterBuffer;
    const rightMeterBuffer = this.scrubRightMeterBuffer;
    let stereoSamples;

    if (leftAnalyser && rightAnalyser && leftMeterBuffer && rightMeterBuffer) {
      leftAnalyser.getFloatTimeDomainData(leftMeterBuffer);
      rightAnalyser.getFloatTimeDomainData(rightMeterBuffer);
      stereoSamples = { left: leftMeterBuffer, right: rightMeterBuffer };
    }

    return calculateAudioMeterSnapshot(
      this.scrubMeterBuffer,
      updatedAt,
      this.getScrubDynamicsSnapshot(updatedAt),
      stereoSamples,
      new Float32Array(this.scrubFrequencyBuffer),
    );
  }

  /**
   * Check if audio buffer is ready for instant scrubbing
   */
  hasAudioBuffer(mediaFileId: string): boolean {
    return this.audioBufferCache.has(mediaFileId);
  }

  private attachScrubEffectChain(
    ctx: AudioContext,
    source: AudioBufferSourceNode,
    volume: number,
    eqGains: number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[]
  ): void {
    this.scrubSourceGain = ctx.createGain();
    this.scrubSourceGain.gain.value = volume;
    this.scrubPanNode = ctx.createStereoPanner();
    this.scrubPanNode.pan.value = pan;
    this.scrubStereoSplitter = ctx.createChannelSplitter(2);
    this.scrubLeftAnalyser = ctx.createAnalyser();
    this.scrubRightAnalyser = ctx.createAnalyser();
    this.scrubLeftAnalyser.fftSize = this.scrubAnalyser?.fftSize ?? 1024;
    this.scrubRightAnalyser.fftSize = this.scrubAnalyser?.fftSize ?? 1024;
    this.scrubLeftAnalyser.smoothingTimeConstant = this.scrubAnalyser?.smoothingTimeConstant ?? 0.2;
    this.scrubRightAnalyser.smoothingTimeConstant = this.scrubAnalyser?.smoothingTimeConstant ?? 0.2;
    this.scrubLeftMeterBuffer = new Float32Array(this.scrubLeftAnalyser.fftSize);
    this.scrubRightMeterBuffer = new Float32Array(this.scrubRightAnalyser.fftSize);
    this.scrubFrequencyBuffer = new Float32Array(this.scrubAnalyser?.frequencyBinCount ?? 512);
    this.scrubProcessorNodes = processors.map(processor => this.createScrubProcessorNode(ctx, processor));

    this.scrubEqFilters = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.4;
      filter.gain.value = eqGains[index] ?? 0;
      return filter;
    });

    source.connect(this.scrubSourceGain);
    let tail: AudioNode = this.scrubSourceGain;
    for (const processor of this.scrubProcessorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectScrubCustomProcessor(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }
    tail.connect(this.scrubEqFilters[0]);
    for (let i = 0; i < this.scrubEqFilters.length - 1; i++) {
      this.scrubEqFilters[i].connect(this.scrubEqFilters[i + 1]);
    }
    this.scrubEqFilters[this.scrubEqFilters.length - 1].connect(this.scrubPanNode);
    this.scrubPanNode.connect(this.scrubStereoSplitter);
    this.scrubStereoSplitter.connect(this.scrubLeftAnalyser, 0);
    this.scrubStereoSplitter.connect(this.scrubRightAnalyser, 1);
    this.scrubPanNode.connect(this.scrubAnalyser!);
  }

  private updateScrubEffects(
    volume: number,
    eqGains: number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[],
  ): void {
    if (this.scrubSourceGain) {
      this.scrubSourceGain.gain.value = Math.max(0, Math.min(4, volume));
    }
    if (this.scrubPanNode) {
      this.scrubPanNode.pan.value = clampAudioPan(pan);
    }

    for (let i = 0; i < this.scrubEqFilters.length; i++) {
      this.scrubEqFilters[i].gain.value = eqGains[i] ?? 0;
    }

    const ctx = this.audioContext;
    if (!ctx) return;
    processors.forEach((processor, index) => {
      const node = this.scrubProcessorNodes[index];
      if (node) updateScrubProcessorNode(ctx, node, processor);
    });
  }

  private createScrubProcessorNode(
    ctx: BaseAudioContext,
    processor: LiveAudioRouteProcessor,
  ): ScrubProcessorNode {
    if (processor.type === 'pan') {
      const panner = ctx.createStereoPanner();
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: 'pan',
        nodes: [panner],
        panner,
      };
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (
      processor.type === 'high-pass' ||
      processor.type === 'low-pass' ||
      processor.type === 'parametric-eq' ||
      processor.type === 'biquad-filter'
    ) {
      const filter = ctx.createBiquadFilter();
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: processor.type,
        nodes: [filter],
        filter,
      };
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'hum-notch') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const filters = Array.from({ length: HUM_NOTCH_MAX_HARMONICS }, () => ctx.createBiquadFilter());
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: 'hum-notch',
        nodes: [input, dryGain, ...filters, wetGain, output],
        inputNode: input,
        outputNode: output,
        dryGain,
        wetGain,
        filters,
      };
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (
      processor.type === 'limiter' ||
      processor.type === 'noise-gate' ||
      processor.type === 'expander' ||
      processor.type === 'de-click' ||
      processor.type === 'noise-reduction' ||
      processor.type === 'spectral-gate' ||
      processor.type === 'dynamic-eq-band' ||
      processor.type === 'saturation' ||
      processor.type === 'polarity-invert' ||
      processor.type === 'mono-sum' ||
      processor.type === 'channel-swap' ||
      processor.type === 'stereo-split'
    ) {
      const scriptProcessor = ctx.createScriptProcessor(1024, 2, 2);
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: processor.type,
        nodes: [scriptProcessor],
        scriptProcessor,
        sampleProcessor: processor,
      };
      attachScrubSampleProcessor(node);
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type !== 'compressor') {
      const gain = ctx.createGain();
      return {
        id: processor.id,
        type: processor.type,
        nodes: [gain],
      };
    }

    const compressor = ctx.createDynamicsCompressor();
    const makeupGain = ctx.createGain();
    const node: ScrubProcessorNode = {
      id: processor.id,
      type: 'compressor',
      nodes: [compressor, makeupGain],
      compressor,
      makeupGain,
    };
    updateScrubProcessorNode(ctx, node, processor);
    return node;
  }

  private getScrubDynamicsSnapshot(updatedAt: number): Record<string, AudioDynamicsReductionSnapshot> | undefined {
    const dynamics: Record<string, AudioDynamicsReductionSnapshot> = {};

    for (const processor of this.scrubProcessorNodes) {
      if (processor.type === 'compressor' && processor.compressor) {
        dynamics[processor.id] = {
          effectId: processor.id,
          processorType: 'compressor',
          gainReductionDb: normalizeScrubDynamicsReductionDb(processor.compressor.reduction),
          updatedAt,
        };
        continue;
      }

      if ((processor.type === 'limiter' || processor.type === 'noise-gate' || processor.type === 'expander' || processor.type === 'dynamic-eq-band') && processor.scriptProcessor) {
        dynamics[processor.id] = {
          effectId: processor.id,
          processorType: processor.type,
          gainReductionDb: normalizeScrubDynamicsReductionDb(processor.gainReductionDb ?? 0),
          updatedAt,
        };
      }
    }

    return Object.keys(dynamics).length > 0 ? dynamics : undefined;
  }

  // Clear cache for a specific media file
  clearForMedia(mediaFileId: string) {
    for (const [key] of this.cache) {
      if (key.startsWith(mediaFileId + '_')) {
        this.cache.delete(key);
      }
    }
    this.preloadQueue = this.preloadQueue.filter((k) => !k.startsWith(mediaFileId + '_'));

    // Also clear audio cache
    const audio = this.audioCache.get(mediaFileId);
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      this.audioCache.delete(mediaFileId);
    }

    // Clear audio buffer cache
    this.audioBufferCache.delete(mediaFileId);
  }

  // Clear entire cache
  clearAll() {
    this.cache.clear();
    this.preloadQueue = [];

    // Clear audio cache
    for (const [, audio] of this.audioCache) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
    }
    this.audioCache.clear();

    // Clear audio buffer cache
    this.audioBufferCache.clear();

    // Clean up audio context
    this.disposeAudioContext();
  }

  /**
   * Dispose the AudioContext used for scrub audio.
   * Stops active scrub audio, closes the context, and resets state.
   */
  disposeAudioContext(): void {
    // Stop any active scrub audio first
    this.stopScrubAudio();

    // Close the AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.scrubGain = null;
    this.scrubAnalyser = null;
    this.scrubStereoSplitter = null;
    this.scrubLeftAnalyser = null;
    this.scrubRightAnalyser = null;
    this.scrubMeterBuffer = null;
    this.scrubLeftMeterBuffer = null;
    this.scrubRightMeterBuffer = null;
    this.scrubFrequencyBuffer = null;

    // Clear audio buffer cache (buffers are tied to the old context)
    this.audioBufferCache.clear();
    this.audioBufferFailed.clear();
    this.audioBufferRetryTime.clear();

    log.info('AudioContext disposed');
  }

  // Bulk preload frames around a position - call when scrubbing starts
  async preloadAroundPosition(mediaFileId: string, frameIndex: number, _fps: number = 30, range: number = SCRUB_PRELOAD_RANGE): Promise<void> {
    const framesToPreload: string[] = [];

    // Generate list of frames to preload (current position +/- range)
    for (let i = -range; i <= range; i++) {
      const frame = frameIndex + i;
      if (frame < 0) continue;

      const key = this.getKey(mediaFileId, frame);
      if (!this.cache.has(key) && !this.preloadQueue.includes(key)) {
        framesToPreload.push(key);
      }
    }

    // Add all to front of queue (highest priority)
    this.preloadQueue = [...framesToPreload, ...this.preloadQueue];

    // Start preloading if not already
    if (!this.isPreloading) {
      this.processPreloadQueue();
    }

    log.debug(`Bulk preload started: ${framesToPreload.length} frames around frame ${frameIndex}`);
  }

  // Preload ALL frames for a media file (for manual cache button)
  // Returns a promise that resolves when preloading is complete
  // onProgress callback receives (loadedFrames, totalFrames)
  async preloadAllFrames(
    mediaFileId: string,
    totalFrames: number,
    _fps: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    log.info(`Starting full preload for ${mediaFileId}: ${totalFrames} frames`);

    let loadedCount = 0;
    const batchSize = 32; // Load 32 frames at a time

    for (let startFrame = 0; startFrame < totalFrames; startFrame += batchSize) {
      const endFrame = Math.min(startFrame + batchSize, totalFrames);
      const batch: Promise<void>[] = [];

      for (let frame = startFrame; frame < endFrame; frame++) {
        const key = this.getKey(mediaFileId, frame);

        // Skip if already cached
        if (this.cache.has(key)) {
          loadedCount++;
          continue;
        }

        // Load frame
        batch.push(
          this.loadFrame(mediaFileId, frame).then(image => {
            if (image) {
              this.addToCache(mediaFileId, frame, image);
            }
            loadedCount++;
          })
        );
      }

      // Wait for batch to complete
      await Promise.all(batch);

      // Report progress
      if (onProgress) {
        onProgress(loadedCount, totalFrames);
      }

      // Yield to main thread
      await new Promise(r => setTimeout(r, 0));
    }

    log.info(`Full preload complete for ${mediaFileId}: ${loadedCount}/${totalFrames} frames cached`);
  }

  // Cancel ongoing preload (for when user clicks stop or navigates away)
  cancelPreload(): void {
    this.preloadQueue = [];
    log.debug('Preload cancelled');
  }

  // Get cache stats with more detail
  getStats() {
    return {
      cachedFrames: this.cache.size,
      maxCacheSize: MAX_CACHE_SIZE,
      preloadQueueSize: this.preloadQueue.length,
      isPreloading: this.isPreloading,
      isScrubbing: this.isScrubbing,
      scrubDirection: this.scrubDirection,
      scrubPreloadQueueDrops: this.scrubPreloadQueueDrops,
      hitRate: this.cacheHits / Math.max(1, this.cacheHits + this.cacheMisses),
    };
  }

  // Cache hit/miss tracking
  private cacheHits = 0;
  private cacheMisses = 0;

  // Log cache performance (call periodically for debugging)
  logPerformance(): void {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? (this.cacheHits / total * 100).toFixed(1) : '0';
    log.debug(`Hit rate: ${hitRate}% (${this.cacheHits}/${total}), cached: ${this.cache.size}/${MAX_CACHE_SIZE}, queue: ${this.preloadQueue.length}`);
  }

  // Reset performance counters
  resetPerformanceCounters(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // Get cached frame ranges for a specific media file (for timeline display)
  // Returns ranges in seconds relative to media file start
  getCachedRanges(mediaFileId: string, fps: number = 30): Array<{ start: number; end: number }> {
    // Collect all cached frame indices for this media file
    const cachedFrames: number[] = [];
    for (const [, entry] of this.cache) {
      if (entry.mediaFileId === mediaFileId) {
        cachedFrames.push(entry.frameIndex);
      }
    }

    if (cachedFrames.length === 0) return [];

    // Sort frames
    cachedFrames.sort((a, b) => a - b);

    // Convert to time ranges, merging adjacent frames
    const ranges: Array<{ start: number; end: number }> = [];
    const frameInterval = 1 / fps;
    const maxGap = frameInterval * 3; // Allow gap of 3 frames before starting new range

    let rangeStart = cachedFrames[0] / fps;
    let rangeEnd = rangeStart + frameInterval;

    for (let i = 1; i < cachedFrames.length; i++) {
      const frameTime = cachedFrames[i] / fps;
      if (frameTime - rangeEnd <= maxGap) {
        // Extend current range
        rangeEnd = frameTime + frameInterval;
      } else {
        // Save current range and start new one
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = frameTime;
        rangeEnd = frameTime + frameInterval;
      }
    }

    // Add final range
    ranges.push({ start: rangeStart, end: rangeEnd });

    return ranges;
  }

  // Get all cached media file IDs
  getCachedMediaIds(): string[] {
    const ids = new Set<string>();
    for (const entry of this.cache.values()) {
      ids.add(entry.mediaFileId);
    }
    return Array.from(ids);
  }
}

// Singleton instance
export const proxyFrameCache = new ProxyFrameCache();

// Global user interaction listener to unlock AudioContext as early as possible.
// Chrome requires a user gesture to start/resume AudioContext.
// This fires on the FIRST interaction with the page (any click, key, touch).
if (typeof document !== 'undefined') {
  const unlockAudio = () => {
    proxyFrameCache.ensureAudioContextResumed();
    document.removeEventListener('mousedown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  document.addEventListener('mousedown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });
  document.addEventListener('touchstart', unlockAudio, { capture: true });
}
