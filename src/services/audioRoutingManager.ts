/**
 * AudioRoutingManager - Routes audio through Web Audio API for live EQ and volume
 *
 * Architecture:
 * HTMLMediaElement -> track Gain/EQ/FX -> track meter -> shared master bus -> Destination
 *
 * Efficiency:
 * - Single shared AudioContext
 * - Lazy connection (only when playing)
 * - Node caching per element (MediaElementSourceNode can only be created once)
 * - Delta updates for filter gains
 */

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
import { Logger } from './logger';
import type { AudioRouteEffectSettings, LiveAudioRouteProcessor } from './audio/audioGraphRouteSettings';
import type { AudioDynamicsReductionSnapshot, AudioMeterSnapshot } from '../types';
import { calculateAudioMeterSnapshot } from './audio/audioMetering';

const log = Logger.create('AudioRouting');

// EQ frequencies (10-band)
const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const HUM_NOTCH_MAX_HARMONICS = 8;
const REVERB_IMPULSE_CACHE_LIMIT = 24;
const ROUTE_CREATE_RETRY_COOLDOWN_MS = 5000;
const ROUTE_CREATE_WARNING_INTERVAL_MS = 15000;

const audioRoutingDebugCounters = {
  applyEffectsCalls: 0,
  routeCreates: 0,
  routeProcessorRebuilds: 0,
  masterProcessorRebuilds: 0,
  reverbImpulseBuilds: 0,
  reverbImpulseCacheHits: 0,
  reverbImpulseCacheEvictions: 0,
  reverbImpulseCacheClears: 0,
  reverbImpulseCacheClearedEntries: 0,
  reverbImpulseBuildMsTotal: 0,
  reverbImpulseBuildMsMax: 0,
};

const reverbImpulseCache = new Map<string, AudioBuffer>();

interface AudioRoute {
  // AudioNode (not just MediaElementAudioSourceNode) so the same chain machinery
  // can route a generated source — e.g. the MIDI synth bus — through track
  // gain/FX/EQ/pan/meter into the shared master bus (issue #182, Phase 4b Step 2).
  sourceNode: AudioNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
  analyserNode: AnalyserNode;
  stereoSplitterNode: ChannelSplitterNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  eqFilters: BiquadFilterNode[];
  processorNodes: AudioRouteProcessorNode[];
  meterBuffer: Float32Array<ArrayBuffer>;
  leftMeterBuffer: Float32Array<ArrayBuffer>;
  rightMeterBuffer: Float32Array<ArrayBuffer>;
  frequencyBuffer: Float32Array<ArrayBuffer>;
  isConnected: boolean;
  lastVolume: number;
  lastPan: number;
  lastEQGains: number[];
  lastProcessorSignature: string;
}

interface MasterAudioRoute {
  inputNode: GainNode;
  gainNode: GainNode;
  analyserNode: AnalyserNode;
  stereoSplitterNode: ChannelSplitterNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  eqFilters: BiquadFilterNode[];
  processorNodes: AudioRouteProcessorNode[];
  meterBuffer: Float32Array<ArrayBuffer>;
  leftMeterBuffer: Float32Array<ArrayBuffer>;
  rightMeterBuffer: Float32Array<ArrayBuffer>;
  frequencyBuffer: Float32Array<ArrayBuffer>;
  lastVolume: number;
  lastEQGains: number[];
  lastProcessorSignature: string;
}

interface AudioRouteProcessorNode {
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
  scriptProcessor?: ScriptProcessorNode;
  sampleProcessor?: LiveAudioRouteProcessor;
  spectralGateState?: SpectralGateState;
  dynamicEqState?: AudioEqDynamicRuntimeState;
  gainByChannel?: number[];
  envelopeByChannel?: number[];
  gainReductionDb?: number;
  delay?: DelayNode;
  feedbackGain?: GainNode;
  dryGain?: GainNode;
  wetGain?: GainNode;
  toneFilter?: BiquadFilterNode;
  convolver?: ConvolverNode;
  waveShaper?: WaveShaperNode;
  lastReverbSignature?: string;
  lastSaturationSignature?: string;
  lowBandFilter?: BiquadFilterNode;
  highBandFilter?: BiquadFilterNode;
}

function clampFrequency(ctx: BaseAudioContext, value: number): number {
  const nyquist = Math.max(20, ctx.sampleRate / 2 - 1);
  return Math.max(10, Math.min(nyquist, finiteNumber(value, 1000)));
}

function processorSignature(processors: readonly LiveAudioRouteProcessor[] = []): string {
  return processors.map(processor => `${processor.id}:${processor.type}`).join('|');
}

function normalizeDynamicsReductionDb(rawReduction: number): number {
  if (!Number.isFinite(rawReduction)) return 0;
  const reduction = rawReduction < 0 ? -rawReduction : rawReduction;
  return Math.max(0, Math.min(60, reduction));
}

function limiterReductionDb(inputLinear: number, outputLinear: number): number {
  if (inputLinear <= 0 || outputLinear <= 0 || outputLinear >= inputLinear) return 0;
  return normalizeDynamicsReductionDb(20 * Math.log10(inputLinear / outputLinear));
}

function roundDebug(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getMediaElementSourceSummary(element: HTMLMediaElement): Record<string, unknown> {
  const currentSrc = element.currentSrc || element.src || '';
  const srcKind = currentSrc.startsWith('blob:')
    ? 'blob'
    : currentSrc.startsWith('data:')
      ? 'data'
      : currentSrc
        ? 'url'
        : 'none';
  return {
    hasSrc: Boolean(currentSrc),
    srcKind,
    srcTail: currentSrc ? currentSrc.slice(-32) : '',
  };
}

function getRouteElementDebugSnapshot(element: HTMLMediaElement): Record<string, unknown> {
  return {
    tagName: element.tagName.toLowerCase(),
    paused: element.paused,
    ended: element.ended,
    muted: element.muted,
    volume: roundDebug(element.volume),
    playbackRate: roundDebug(element.playbackRate),
    defaultPlaybackRate: roundDebug(element.defaultPlaybackRate),
    currentTime: roundDebug(element.currentTime),
    duration: Number.isFinite(element.duration) ? roundDebug(element.duration) : null,
    readyState: element.readyState,
    networkState: element.networkState,
    seeking: element.seeking,
    error: element.error
      ? {
          code: element.error.code,
          message: element.error.message,
        }
      : null,
    ...getMediaElementSourceSummary(element),
  };
}

function getProcessorDebugSnapshot(processor: AudioRouteProcessorNode): Record<string, unknown> {
  return {
    id: processor.id,
    type: processor.type,
    nodeCount: processor.nodes.length,
    hasScriptProcessor: Boolean(processor.scriptProcessor),
    lastReverbSignature: processor.lastReverbSignature,
    lastSaturationSignature: processor.lastSaturationSignature,
  };
}

function reverbImpulseCacheKey(
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): string {
  return [
    ctx.sampleRate,
    roomSize.toFixed(3),
    decaySeconds.toFixed(3),
    damping.toFixed(3),
  ].join(':');
}

function clearReverbImpulseCache(): number {
  const clearedEntries = reverbImpulseCache.size;
  if (clearedEntries === 0) return 0;
  reverbImpulseCache.clear();
  audioRoutingDebugCounters.reverbImpulseCacheClears++;
  audioRoutingDebugCounters.reverbImpulseCacheClearedEntries += clearedEntries;
  return clearedEntries;
}

function getOrCreateReverbImpulse(
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): AudioBuffer {
  const key = reverbImpulseCacheKey(ctx, roomSize, decaySeconds, damping);
  const cached = reverbImpulseCache.get(key);
  if (cached) {
    audioRoutingDebugCounters.reverbImpulseCacheHits++;
    reverbImpulseCache.delete(key);
    reverbImpulseCache.set(key, cached);
    return cached;
  }

  const startedAt = performance.now();
  const buffer = createReverbImpulse(ctx, roomSize, decaySeconds, damping);
  const elapsedMs = performance.now() - startedAt;
  audioRoutingDebugCounters.reverbImpulseBuilds++;
  audioRoutingDebugCounters.reverbImpulseBuildMsTotal += elapsedMs;
  audioRoutingDebugCounters.reverbImpulseBuildMsMax = Math.max(
    audioRoutingDebugCounters.reverbImpulseBuildMsMax,
    elapsedMs,
  );

  reverbImpulseCache.set(key, buffer);
  while (reverbImpulseCache.size > REVERB_IMPULSE_CACHE_LIMIT) {
    const oldestKey = reverbImpulseCache.keys().next().value;
    if (oldestKey === undefined) break;
    reverbImpulseCache.delete(oldestKey);
    audioRoutingDebugCounters.reverbImpulseCacheEvictions++;
  }
  return buffer;
}

function updateProcessorNode(
  ctx: BaseAudioContext,
  node: AudioRouteProcessorNode,
  processor: LiveAudioRouteProcessor,
): void {
  if (processor.type === 'pan' && node.panner) {
    node.panner.pan.value = clampAudioPan(finiteNumber(processor.pan, 0));
    return;
  }

  if (processor.type === 'parametric-eq' && node.filter) {
    node.filter.type = 'peaking';
    node.filter.frequency.value = clampFrequency(ctx, processor.frequencyHz);
    node.filter.Q.value = Math.max(0.0001, Math.min(30, finiteNumber(processor.q, 0.707)));
    node.filter.gain.value = Math.max(-48, Math.min(48, finiteNumber(processor.gainDb, 0)));
    return;
  }

  if ((processor.type === 'high-pass' || processor.type === 'low-pass') && node.filter) {
    node.filter.type = processor.type === 'high-pass' ? 'highpass' : 'lowpass';
    node.filter.frequency.value = clampFrequency(ctx, processor.frequencyHz);
    node.filter.Q.value = Math.max(0.0001, Math.min(30, finiteNumber(processor.q, 0.707)));
    return;
  }

  if (processor.type === 'biquad-filter' && node.filter) {
    node.filter.type = processor.filterType;
    node.filter.frequency.value = clampFrequency(ctx, processor.frequencyHz);
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
    processor.type === 'de-esser' &&
    node.lowBandFilter &&
    node.highBandFilter &&
    node.compressor &&
    node.makeupGain
  ) {
    const frequency = clampFrequency(ctx, processor.frequencyHz);
    node.lowBandFilter.frequency.value = frequency;
    node.highBandFilter.frequency.value = frequency;
    node.lowBandFilter.Q.value = 0.707;
    node.highBandFilter.Q.value = 0.707;
    node.compressor.threshold.value = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, 0)));
    node.compressor.ratio.value = Math.max(1, Math.min(20, finiteNumber(processor.ratio, 1)));
    node.compressor.knee.value = Math.max(0, Math.min(40, finiteNumber(processor.kneeDb, 6)));
    node.compressor.attack.value = Math.max(0, Math.min(1, finiteNumber(processor.attackMs, 1) / 1000));
    node.compressor.release.value = Math.max(0.001, Math.min(1, finiteNumber(processor.releaseMs, 80) / 1000));
    node.makeupGain.gain.value = Math.max(0, Math.min(4, dbToLinearGain(processor.makeupGainDb)));
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
      processor.type === 'polarity-invert' ||
      processor.type === 'mono-sum' ||
      processor.type === 'channel-swap' ||
      processor.type === 'stereo-split'
    ) &&
    node.scriptProcessor
  ) {
    node.sampleProcessor = processor;
    return;
  }

  if (processor.type === 'delay' && node.delay && node.feedbackGain && node.dryGain && node.wetGain && node.toneFilter) {
    node.delay.delayTime.value = Math.max(0.001, Math.min(2, finiteNumber(processor.delayMs, 250) / 1000));
    node.feedbackGain.gain.value = Math.max(0, Math.min(0.95, finiteNumber(processor.feedback, 0)));
    const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
    node.dryGain.gain.value = 1 - mix;
    node.wetGain.gain.value = mix;
    node.toneFilter.frequency.value = clampFrequency(ctx, finiteNumber(processor.toneHz, 12000));
    return;
  }

  if (processor.type === 'reverb' && node.convolver && node.dryGain && node.wetGain) {
    const roomSize = Math.max(0, Math.min(1, finiteNumber(processor.roomSize, 0.35)));
    const decaySeconds = Math.max(0.1, Math.min(12, finiteNumber(processor.decaySeconds, 1.2)));
    const damping = Math.max(0, Math.min(1, finiteNumber(processor.damping, 0.35)));
    const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
    const signature = `${ctx.sampleRate}:${roomSize.toFixed(3)}:${decaySeconds.toFixed(3)}:${damping.toFixed(3)}`;
    node.dryGain.gain.value = 1 - mix;
    node.wetGain.gain.value = mix;
    if (node.lastReverbSignature !== signature) {
      node.convolver.buffer = getOrCreateReverbImpulse(ctx, roomSize, decaySeconds, damping);
      node.lastReverbSignature = signature;
    }
  }

  if (processor.type === 'saturation' && node.waveShaper && node.dryGain && node.wetGain && node.toneFilter) {
    const driveDb = Math.max(0, Math.min(48, finiteNumber(processor.driveDb, 0)));
    const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
    const signature = `${driveDb.toFixed(3)}`;
    node.dryGain.gain.value = 1 - mix;
    node.wetGain.gain.value = mix;
    node.toneFilter.type = 'lowpass';
    node.toneFilter.frequency.value = clampFrequency(ctx, finiteNumber(processor.toneHz, 16000));
    if (node.lastSaturationSignature !== signature) {
      node.waveShaper.curve = createSaturationCurve(driveDb);
      node.lastSaturationSignature = signature;
    }
  }
}

function copyInputToOutput(input: AudioBuffer, output: AudioBuffer): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    output.getChannelData(channel).set(source);
  }
}

function processLimiterFrame(
  node: AudioRouteProcessorNode,
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
      maxReductionDb = Math.max(maxReductionDb, limiterReductionDb(Math.abs(driven), Math.abs(limited)));
    }
  }

  node.gainReductionDb = maxReductionDb;
}

function processNoiseGateFrame(
  node: AudioRouteProcessorNode,
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
      maxReductionDb = Math.max(maxReductionDb, normalizeDynamicsReductionDb(-20 * Math.log10(Math.max(0.000001, gain))));
    }
    gainByChannel[channel] = gain;
  }

  node.gainByChannel = gainByChannel;
  node.gainReductionDb = maxReductionDb;
}

function calculateExpanderTargetGain(sample: number, processor: Extract<LiveAudioRouteProcessor, { type: 'expander' }>): number {
  const thresholdDb = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, 0)));
  const ratio = Math.max(1, Math.min(20, finiteNumber(processor.ratio, 1)));
  const rangeDb = Math.max(0, Math.min(80, finiteNumber(processor.rangeDb, 0)));
  if (ratio <= 1.0001 || rangeDb <= 0.0001) return 1;
  const inputDb = 20 * Math.log10(Math.max(0.000001, Math.abs(sample)));
  if (inputDb >= thresholdDb) return 1;
  const reductionDb = Math.min(rangeDb, (thresholdDb - inputDb) * (ratio - 1));
  return dbToLinearGain(-reductionDb);
}

function processExpanderFrame(
  node: AudioRouteProcessorNode,
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
      const targetGain = calculateExpanderTargetGain(sample, processor);
      const coefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + coefficient * (gain - targetGain);
      target[sampleIndex] = sample * gain;
      maxReductionDb = Math.max(maxReductionDb, normalizeDynamicsReductionDb(-20 * Math.log10(Math.max(0.000001, gain))));
    }
    gainByChannel[channel] = gain;
  }

  node.gainByChannel = gainByChannel;
  node.gainReductionDb = maxReductionDb;
}

function calculateNoiseReductionTargetGain(
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

function processNoiseReductionFrame(
  node: AudioRouteProcessorNode,
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
      const targetGain = calculateNoiseReductionTargetGain(envelope, processor);
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

function processSpectralGateFrame(
  node: AudioRouteProcessorNode,
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

function processPolarityInvertFrame(
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

function processMonoSumFrame(input: AudioBuffer, output: AudioBuffer): void {
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

function processChannelSwapFrame(input: AudioBuffer, output: AudioBuffer): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const sourceChannel = input.numberOfChannels >= 2
      ? channel === 0 ? 1 : channel === 1 ? 0 : channel
      : channel;
    const source = input.getChannelData(Math.max(0, Math.min(sourceChannel, fallbackChannel)));
    output.getChannelData(channel).set(source);
  }
}

function processDeClickFrame(
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

function processStereoSplitFrame(
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

function attachSampleProcessor(node: AudioRouteProcessorNode): void {
  const scriptProcessor = node.scriptProcessor;
  if (!scriptProcessor) return;
  scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
    const processor = node.sampleProcessor;
    if (!processor) {
      copyInputToOutput(event.inputBuffer, event.outputBuffer);
      node.gainReductionDb = 0;
      return;
    }

    if (processor.type === 'limiter') {
      processLimiterFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor.type === 'noise-gate') {
      processNoiseGateFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor.type === 'expander') {
      processExpanderFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor.type === 'de-click') {
      processDeClickFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    if (processor.type === 'noise-reduction') {
      processNoiseReductionFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor.type === 'spectral-gate') {
      processSpectralGateFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor.type === 'dynamic-eq-band') {
      processDynamicEqBandFrame(node, event.inputBuffer, event.outputBuffer, processor);
      return;
    }

    if (processor.type === 'polarity-invert') {
      processPolarityInvertFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    if (processor.type === 'mono-sum') {
      processMonoSumFrame(event.inputBuffer, event.outputBuffer);
      node.gainReductionDb = 0;
      return;
    }

    if (processor.type === 'channel-swap') {
      processChannelSwapFrame(event.inputBuffer, event.outputBuffer);
      node.gainReductionDb = 0;
      return;
    }

    if (processor.type === 'stereo-split') {
      processStereoSplitFrame(event.inputBuffer, event.outputBuffer, processor);
      node.gainReductionDb = 0;
      return;
    }

    copyInputToOutput(event.inputBuffer, event.outputBuffer);
    node.gainReductionDb = 0;
  };
}

function processDynamicEqBandFrame(
  node: AudioRouteProcessorNode,
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

function createReverbImpulse(
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * decaySeconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const highDamping = 0.08 + damping * 0.72;
  const roomGain = 0.18 + roomSize * 0.42;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let filteredNoise = 0;
    let seed = 0x12345678 + channel * 0x9e3779b9;
    for (let index = 0; index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      filteredNoise = filteredNoise * highDamping + noise * (1 - highDamping);
      const decay = Math.pow(1 - index / length, 2.4 + damping * 2.2);
      data[index] = filteredNoise * decay * roomGain;
    }
  }

  return buffer;
}

function createSaturationCurve(driveDb: number): Float32Array<ArrayBuffer> {
  const length = 1024;
  const curve = new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
  if (driveDb <= 0.001) {
    for (let index = 0; index < length; index += 1) {
      curve[index] = (index / (length - 1)) * 2 - 1;
    }
    return curve;
  }

  const drive = dbToLinearGain(driveDb);
  const normalizer = Math.tanh(drive) || 1;
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.max(-1, Math.min(1, Math.tanh(x * drive) / normalizer));
  }
  return curve;
}

function reconnectCustomProcessorInternal(node: AudioRouteProcessorNode): void {
  if (
    node.type === 'delay' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.delay &&
    node.feedbackGain &&
    node.toneFilter &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.delay);
    node.delay.connect(node.toneFilter);
    node.toneFilter.connect(node.feedbackGain);
    node.feedbackGain.connect(node.delay);
    node.toneFilter.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'reverb' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.convolver &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.convolver);
    node.convolver.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'saturation' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.waveShaper &&
    node.toneFilter &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.waveShaper);
    node.waveShaper.connect(node.toneFilter);
    node.toneFilter.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

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
    return;
  }

  if (
    node.type === 'de-esser' &&
    node.inputNode &&
    node.outputNode &&
    node.lowBandFilter &&
    node.highBandFilter &&
    node.compressor &&
    node.makeupGain
  ) {
    node.inputNode.connect(node.lowBandFilter);
    node.inputNode.connect(node.highBandFilter);
    node.lowBandFilter.connect(node.outputNode);
    node.highBandFilter.connect(node.compressor);
    node.compressor.connect(node.makeupGain);
    node.makeupGain.connect(node.outputNode);
  }
}

class AudioRoutingManager {
  private audioContext: AudioContext | null = null;
  private masterRoute: MasterAudioRoute | null = null;
  private routes = new Map<HTMLMediaElement, AudioRoute>();
  // Routes whose source is an arbitrary AudioNode (e.g. the per-track MIDI synth
  // bus), keyed by a stable string id (the track id). They reuse the exact same
  // gain/FX/EQ/pan/meter chain as media routes and feed the shared master bus.
  private nodeRoutes = new Map<string, AudioRoute>();
  private routeCreateFailures = new WeakMap<HTMLMediaElement, { retryAt: number; lastLoggedAt: number }>();
  private contextResumePromise: Promise<void> | null = null;

  /**
   * Get or create the shared AudioContext
   */
  private async getContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.masterRoute = null;
      log.info('Created new AudioContext');
    }

    // Resume if suspended (autoplay policy)
    if (this.audioContext.state === 'suspended') {
      if (!this.contextResumePromise) {
        this.contextResumePromise = this.audioContext.resume().then(() => {
          this.contextResumePromise = null;
        });
      }
      await this.contextResumePromise;
    }

    return this.audioContext;
  }

  private getOrCreateMasterRoute(ctx: AudioContext): MasterAudioRoute {
    if (this.masterRoute) return this.masterRoute;

    const inputNode = ctx.createGain();
    inputNode.gain.value = 1;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1;

    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.2;

    const stereoSplitterNode = ctx.createChannelSplitter(2);
    const leftAnalyserNode = ctx.createAnalyser();
    const rightAnalyserNode = ctx.createAnalyser();
    leftAnalyserNode.fftSize = analyserNode.fftSize;
    rightAnalyserNode.fftSize = analyserNode.fftSize;
    leftAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;
    rightAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;

    const eqFilters: BiquadFilterNode[] = EQ_FREQUENCIES.map(freq => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });

    this.masterRoute = {
      inputNode,
      gainNode,
      analyserNode,
      stereoSplitterNode,
      leftAnalyserNode,
      rightAnalyserNode,
      eqFilters,
      processorNodes: [],
      meterBuffer: new Float32Array(analyserNode.fftSize),
      leftMeterBuffer: new Float32Array(leftAnalyserNode.fftSize),
      rightMeterBuffer: new Float32Array(rightAnalyserNode.fftSize),
      frequencyBuffer: new Float32Array(analyserNode.frequencyBinCount),
      lastVolume: 1,
      lastEQGains: new Array(10).fill(0),
      lastProcessorSignature: '',
    };

    this.reconnectMasterRouteChain(this.masterRoute);
    return this.masterRoute;
  }

  /**
   * Get or create audio route for an element
   */
  private async getOrCreateRoute(element: HTMLMediaElement): Promise<AudioRoute | null> {
    // Check if route already exists
    let route = this.routes.get(element);
    if (route) {
      if (!route.isConnected) {
        this.reconnectRouteChain(route);
      }
      return route;
    }

    const previousFailure = this.routeCreateFailures.get(element);
    const now = performance.now();
    if (previousFailure && now < previousFailure.retryAt) {
      return null;
    }

    try {
      const ctx = await this.getContext();
      this.getOrCreateMasterRoute(ctx);

      // Create source node (can only be done ONCE per element)
      const sourceNode = ctx.createMediaElementSource(element);

      // Create gain node for volume
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;

      const panNode = ctx.createStereoPanner();
      panNode.pan.value = 0;

      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.2;
      const stereoSplitterNode = ctx.createChannelSplitter(2);
      const leftAnalyserNode = ctx.createAnalyser();
      const rightAnalyserNode = ctx.createAnalyser();
      leftAnalyserNode.fftSize = analyserNode.fftSize;
      rightAnalyserNode.fftSize = analyserNode.fftSize;
      leftAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;
      rightAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;

      // Create EQ filter chain
      const eqFilters: BiquadFilterNode[] = EQ_FREQUENCIES.map(freq => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4; // Standard Q for 10-band EQ
        filter.gain.value = 0; // Default: no boost/cut
        return filter;
      });

      // Connect chain: source -> track gain/FX/EQ/pan -> track meter -> master bus
      route = {
        sourceNode,
        gainNode,
        panNode,
        analyserNode,
        stereoSplitterNode,
        leftAnalyserNode,
        rightAnalyserNode,
        eqFilters,
        processorNodes: [],
        meterBuffer: new Float32Array(analyserNode.fftSize),
        leftMeterBuffer: new Float32Array(leftAnalyserNode.fftSize),
        rightMeterBuffer: new Float32Array(rightAnalyserNode.fftSize),
        frequencyBuffer: new Float32Array(analyserNode.frequencyBinCount),
        isConnected: true,
        lastVolume: 1,
        lastPan: 0,
        lastEQGains: new Array(10).fill(0),
        lastProcessorSignature: '',
      };
      this.reconnectRouteChain(route);

      this.routes.set(element, route);
      this.routeCreateFailures.delete(element);
      audioRoutingDebugCounters.routeCreates++;
      log.debug('Created audio route for element');

      return route;
    } catch (err) {
      // MediaElementSourceNode can fail if element is already connected elsewhere
      // or if there's a CORS issue with the audio source
      const failure = this.routeCreateFailures.get(element);
      if (!failure || now - failure.lastLoggedAt > ROUTE_CREATE_WARNING_INTERVAL_MS) {
        log.warn('Failed to create audio route:', err);
      }
      this.routeCreateFailures.set(element, {
        retryAt: now + ROUTE_CREATE_RETRY_COOLDOWN_MS,
        lastLoggedAt: failure?.lastLoggedAt && now - failure.lastLoggedAt <= ROUTE_CREATE_WARNING_INTERVAL_MS
          ? failure.lastLoggedAt
          : now,
      });
      return null;
    }
  }

  /**
   * Apply volume and EQ to an audio element
   * Call this every frame for elements that are playing
   */
  async applyEffects(
    element: HTMLMediaElement,
    volume: number,
    eqGains: number[], // Array of 10 gain values in dB (-12 to +12)
    pan = 0,
    processors: readonly LiveAudioRouteProcessor[] = [],
    masterRoute?: AudioRouteEffectSettings,
  ): Promise<boolean> {
    audioRoutingDebugCounters.applyEffectsCalls++;
    const route = await this.getOrCreateRoute(element);
    if (!route) {
      // Fallback: just set element volume directly (no EQ)
      element.volume = Math.max(0, Math.min(1, volume * (masterRoute?.volume ?? 1)));
      return false;
    }

    const ctx = this.audioContext;
    if (!ctx) return false;
    this.updateMasterRoute(ctx, masterRoute);
    this.updateRouteProcessors(route, ctx, processors);

    // Update volume if changed (with small delta threshold)
    if (Math.abs(route.lastVolume - volume) > 0.001) {
      // Web Audio gain can go above 1, but clamp for sanity
      route.gainNode.gain.value = Math.max(0, Math.min(4, volume));
      route.lastVolume = volume;
    }

    const clampedPan = clampAudioPan(pan);
    if (Math.abs(route.lastPan - clampedPan) > 0.001) {
      route.panNode.pan.value = clampedPan;
      route.lastPan = clampedPan;
    }

    // Update EQ gains if changed
    for (let i = 0; i < 10; i++) {
      const gain = eqGains[i] ?? 0;
      if (Math.abs(route.lastEQGains[i] - gain) > 0.01) {
        route.eqFilters[i].gain.value = gain;
        route.lastEQGains[i] = gain;
      }
    }

    // When using Web Audio routing, the element volume should be 1
    // (volume is controlled by the GainNode)
    if (element.volume !== 1) {
      element.volume = 1;
    }

    return true;
  }

  /**
   * Ensure the shared AudioContext + master bus exist and return the context.
   * Synchronous (creates the context if needed and kicks a background resume) so
   * generated sources like the MIDI synth can build nodes in the same context and
   * route into the same master bus that media tracks use. Mirrors getContext()
   * without awaiting the resume.
   */
  ensureSharedContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.masterRoute = null;
      log.info('Created new AudioContext (shared)');
    }
    if (this.audioContext.state === 'suspended' && !this.contextResumePromise) {
      this.contextResumePromise = this.audioContext
        .resume()
        .then(() => {
          this.contextResumePromise = null;
        })
        .catch(() => {
          this.contextResumePromise = null;
        });
    }
    this.getOrCreateMasterRoute(this.audioContext);
    return this.audioContext;
  }

  /** The active shared AudioContext, or null before one is created. */
  getActiveContext(): AudioContext | null {
    return this.audioContext;
  }

  async resumeContext(): Promise<void> {
    await this.getContext();
  }

  /**
   * Apply volume/EQ/pan/FX/master to an arbitrary node source (e.g. the MIDI
   * synth bus), keyed by a stable id. Builds/maintains a full per-track chain
   * identical to a media route and feeds the shared master bus. Returns false if
   * no context exists yet (call ensureSharedContext() first).
   */
  applyNodeEffects(
    key: string,
    sourceNode: AudioNode,
    volume: number,
    eqGains: number[],
    pan = 0,
    processors: readonly LiveAudioRouteProcessor[] = [],
    masterRoute?: AudioRouteEffectSettings,
  ): boolean {
    const ctx = this.audioContext;
    if (!ctx) return false;
    const route = this.getOrCreateNodeRoute(key, sourceNode, ctx);
    this.updateMasterRoute(ctx, masterRoute);
    this.updateRouteProcessors(route, ctx, processors);

    if (Math.abs(route.lastVolume - volume) > 0.001) {
      route.gainNode.gain.value = Math.max(0, Math.min(4, volume));
      route.lastVolume = volume;
    }

    const clampedPan = clampAudioPan(pan);
    if (Math.abs(route.lastPan - clampedPan) > 0.001) {
      route.panNode.pan.value = clampedPan;
      route.lastPan = clampedPan;
    }

    for (let i = 0; i < 10; i++) {
      const gain = eqGains[i] ?? 0;
      if (Math.abs(route.lastEQGains[i] - gain) > 0.01) {
        route.eqFilters[i].gain.value = gain;
        route.lastEQGains[i] = gain;
      }
    }

    return true;
  }

  getNodeMeterSnapshot(key: string, updatedAt = performance.now()): AudioMeterSnapshot | null {
    const route = this.nodeRoutes.get(key);
    if (!route) return null;

    route.analyserNode.getFloatTimeDomainData(route.meterBuffer);
    route.analyserNode.getFloatFrequencyData(route.frequencyBuffer);
    route.leftAnalyserNode.getFloatTimeDomainData(route.leftMeterBuffer);
    route.rightAnalyserNode.getFloatTimeDomainData(route.rightMeterBuffer);
    return calculateAudioMeterSnapshot(
      route.meterBuffer,
      updatedAt,
      this.getRouteDynamicsSnapshot(route, updatedAt),
      { left: route.leftMeterBuffer, right: route.rightMeterBuffer },
      new Float32Array(route.frequencyBuffer),
    );
  }

  /** Tear down a node route. Does not disconnect the source node (caller owns it). */
  removeNodeRoute(key: string): void {
    const route = this.nodeRoutes.get(key);
    if (!route) return;
    try {
      route.gainNode.disconnect();
      route.panNode.disconnect();
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Ignore disconnect errors
    }
    this.nodeRoutes.delete(key);
  }

  private getOrCreateNodeRoute(key: string, sourceNode: AudioNode, ctx: AudioContext): AudioRoute {
    const existing = this.nodeRoutes.get(key);
    if (existing) {
      // Re-wire if the source node was rebuilt (e.g. synth recreated).
      if (existing.sourceNode !== sourceNode) {
        try {
          existing.sourceNode.disconnect();
        } catch {
          // ignore
        }
        existing.sourceNode = sourceNode;
        this.reconnectRouteChain(existing);
      }
      return existing;
    }

    this.getOrCreateMasterRoute(ctx);

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1;
    const panNode = ctx.createStereoPanner();
    panNode.pan.value = 0;
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.2;
    const stereoSplitterNode = ctx.createChannelSplitter(2);
    const leftAnalyserNode = ctx.createAnalyser();
    const rightAnalyserNode = ctx.createAnalyser();
    leftAnalyserNode.fftSize = analyserNode.fftSize;
    rightAnalyserNode.fftSize = analyserNode.fftSize;
    leftAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;
    rightAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;

    const eqFilters: BiquadFilterNode[] = EQ_FREQUENCIES.map(freq => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });

    const route: AudioRoute = {
      sourceNode,
      gainNode,
      panNode,
      analyserNode,
      stereoSplitterNode,
      leftAnalyserNode,
      rightAnalyserNode,
      eqFilters,
      processorNodes: [],
      meterBuffer: new Float32Array(analyserNode.fftSize),
      leftMeterBuffer: new Float32Array(leftAnalyserNode.fftSize),
      rightMeterBuffer: new Float32Array(rightAnalyserNode.fftSize),
      frequencyBuffer: new Float32Array(analyserNode.frequencyBinCount),
      isConnected: true,
      lastVolume: 1,
      lastPan: 0,
      lastEQGains: new Array(10).fill(0),
      lastProcessorSignature: '',
    };
    this.reconnectRouteChain(route);
    this.nodeRoutes.set(key, route);
    return route;
  }

  /**
   * Check if an element has an active audio route
   */
  hasRoute(element: HTMLMediaElement): boolean {
    return this.routes.has(element);
  }

  pauseAllRoutedMedia(): void {
    for (const element of this.routes.keys()) {
      element.pause();
    }
  }

  getMeterSnapshot(element: HTMLMediaElement, updatedAt = performance.now()): AudioMeterSnapshot | null {
    const route = this.routes.get(element);
    if (!route) return null;

    route.analyserNode.getFloatTimeDomainData(route.meterBuffer);
    route.analyserNode.getFloatFrequencyData(route.frequencyBuffer);
    route.leftAnalyserNode.getFloatTimeDomainData(route.leftMeterBuffer);
    route.rightAnalyserNode.getFloatTimeDomainData(route.rightMeterBuffer);
    return calculateAudioMeterSnapshot(
      route.meterBuffer,
      updatedAt,
      this.getRouteDynamicsSnapshot(route, updatedAt),
      { left: route.leftMeterBuffer, right: route.rightMeterBuffer },
      new Float32Array(route.frequencyBuffer),
    );
  }

  getMasterMeterSnapshot(updatedAt = performance.now()): AudioMeterSnapshot | null {
    const route = this.masterRoute;
    if (!route) return null;

    route.analyserNode.getFloatTimeDomainData(route.meterBuffer);
    route.analyserNode.getFloatFrequencyData(route.frequencyBuffer);
    route.leftAnalyserNode.getFloatTimeDomainData(route.leftMeterBuffer);
    route.rightAnalyserNode.getFloatTimeDomainData(route.rightMeterBuffer);
    return calculateAudioMeterSnapshot(
      route.meterBuffer,
      updatedAt,
      this.getRouteDynamicsSnapshot(route, updatedAt),
      { left: route.leftMeterBuffer, right: route.rightMeterBuffer },
      new Float32Array(route.frequencyBuffer),
    );
  }

  /**
   * Disconnect and remove route for an element
   * Call when element is no longer needed
   */
  removeRoute(element: HTMLMediaElement): void {
    const route = this.routes.get(element);
    if (route) {
      try {
        route.sourceNode.disconnect();
        route.gainNode.disconnect();
        route.panNode.disconnect();
        route.analyserNode.disconnect();
        route.stereoSplitterNode.disconnect();
        route.leftAnalyserNode.disconnect();
        route.rightAnalyserNode.disconnect();
        route.eqFilters.forEach(f => f.disconnect());
        route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      } catch {
        // Ignore disconnect errors
      }
      route.isConnected = false;
      log.debug('Removed audio route');
    }
  }

  disposeRoute(element: HTMLMediaElement): void {
    this.removeRoute(element);
    this.routes.delete(element);
  }

  /**
   * Clean up all routes and close context
   */
  dispose(): void {
    for (const element of Array.from(this.routes.keys())) {
      this.disposeRoute(element);
    }
    for (const key of [...this.nodeRoutes.keys()]) {
      this.removeNodeRoute(key);
    }
    this.disconnectMasterRoute();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.masterRoute = null;
    const clearedReverbImpulses = this.clearReverbImpulseCache();
    log.info('AudioRoutingManager disposed', { clearedReverbImpulses });
  }

  clearReverbImpulseCache(): number {
    return clearReverbImpulseCache();
  }

  /**
   * Get the number of active routes (for debugging)
   */
  get activeRouteCount(): number {
    return this.routes.size;
  }

  getDebugSnapshot(): Record<string, unknown> {
    const context = this.audioContext as (AudioContext & { outputLatency?: number }) | null;
    return {
      context: context
        ? {
            state: context.state,
            sampleRate: context.sampleRate,
            currentTime: roundDebug(context.currentTime),
            baseLatencyMs: roundDebug((context.baseLatency ?? 0) * 1000, 2),
            outputLatencyMs: typeof context.outputLatency === 'number'
              ? roundDebug(context.outputLatency * 1000, 2)
              : undefined,
            destinationMaxChannelCount: context.destination.maxChannelCount,
            resumePending: this.contextResumePromise !== null,
          }
        : null,
      routeCount: this.routes.size,
      masterRoute: this.masterRoute
        ? {
            gain: roundDebug(this.masterRoute.gainNode.gain.value),
            processorCount: this.masterRoute.processorNodes.length,
            processorTypes: this.masterRoute.processorNodes.map(processor => processor.type),
            processors: this.masterRoute.processorNodes.map(getProcessorDebugSnapshot),
            eqGains: this.masterRoute.lastEQGains.map(gain => roundDebug(gain, 2)),
            analyserFftSize: this.masterRoute.analyserNode.fftSize,
            lastProcessorSignature: this.masterRoute.lastProcessorSignature,
          }
        : null,
      routes: Array.from(this.routes.entries()).map(([element, route], index) => ({
        index,
        element: getRouteElementDebugSnapshot(element),
        gain: roundDebug(route.gainNode.gain.value),
        pan: roundDebug(route.panNode.pan.value),
        processorCount: route.processorNodes.length,
        processorTypes: route.processorNodes.map(processor => processor.type),
        processors: route.processorNodes.map(getProcessorDebugSnapshot),
        eqGains: route.lastEQGains.map(gain => roundDebug(gain, 2)),
        analyserFftSize: route.analyserNode.fftSize,
        isConnected: route.isConnected,
        lastProcessorSignature: route.lastProcessorSignature,
      })),
      counters: {
        ...audioRoutingDebugCounters,
        reverbImpulseCacheLimit: REVERB_IMPULSE_CACHE_LIMIT,
        reverbImpulseCacheSize: reverbImpulseCache.size,
        reverbImpulseBuildMsAvg: audioRoutingDebugCounters.reverbImpulseBuilds > 0
          ? roundDebug(
              audioRoutingDebugCounters.reverbImpulseBuildMsTotal / audioRoutingDebugCounters.reverbImpulseBuilds,
              2,
            )
          : 0,
        reverbImpulseBuildMsMax: roundDebug(audioRoutingDebugCounters.reverbImpulseBuildMsMax, 2),
      },
    };
  }

  private disconnectMasterRoute(): void {
    const route = this.masterRoute;
    if (!route) return;
    try {
      route.inputNode.disconnect();
      route.gainNode.disconnect();
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Ignore disconnect errors during teardown.
    }
  }

  private createProcessorNode(
    ctx: BaseAudioContext,
    processor: LiveAudioRouteProcessor,
  ): AudioRouteProcessorNode {
    if (processor.type === 'pan') {
      const panner = ctx.createStereoPanner();
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: 'pan',
        nodes: [panner],
        panner,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (
      processor.type === 'high-pass' ||
      processor.type === 'low-pass' ||
      processor.type === 'parametric-eq' ||
      processor.type === 'biquad-filter'
    ) {
      const filter = ctx.createBiquadFilter();
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: processor.type,
        nodes: [filter],
        filter,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'hum-notch') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const filters = Array.from({ length: HUM_NOTCH_MAX_HARMONICS }, () => ctx.createBiquadFilter());
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      input.connect(dryGain);
      dryGain.connect(output);
      let wetTail: AudioNode = input;
      for (const filter of filters) {
        wetTail.connect(filter);
        wetTail = filter;
      }
      wetTail.connect(wetGain);
      wetGain.connect(output);
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: 'hum-notch',
        nodes: [input, dryGain, ...filters, wetGain, output],
        inputNode: input,
        outputNode: output,
        dryGain,
        wetGain,
        filters,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'delay') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const delay = ctx.createDelay(2);
      const feedbackGain = ctx.createGain();
      const toneFilter = ctx.createBiquadFilter();
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      toneFilter.type = 'lowpass';
      input.connect(dryGain);
      dryGain.connect(output);
      input.connect(delay);
      delay.connect(toneFilter);
      toneFilter.connect(feedbackGain);
      feedbackGain.connect(delay);
      toneFilter.connect(wetGain);
      wetGain.connect(output);
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: 'delay',
        nodes: [input, dryGain, delay, feedbackGain, toneFilter, wetGain, output],
        inputNode: input,
        outputNode: output,
        delay,
        feedbackGain,
        dryGain,
        wetGain,
        toneFilter,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'reverb') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const convolver = ctx.createConvolver();
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      input.connect(dryGain);
      dryGain.connect(output);
      input.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(output);
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: 'reverb',
        nodes: [input, dryGain, convolver, wetGain, output],
        inputNode: input,
        outputNode: output,
        dryGain,
        wetGain,
        convolver,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'saturation') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const waveShaper = ctx.createWaveShaper();
      const toneFilter = ctx.createBiquadFilter();
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      input.connect(dryGain);
      dryGain.connect(output);
      input.connect(waveShaper);
      waveShaper.connect(toneFilter);
      toneFilter.connect(wetGain);
      wetGain.connect(output);
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: 'saturation',
        nodes: [input, dryGain, waveShaper, toneFilter, wetGain, output],
        inputNode: input,
        outputNode: output,
        dryGain,
        wetGain,
        waveShaper,
        toneFilter,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'de-esser') {
      const input = ctx.createGain();
      const lowBandFilter = ctx.createBiquadFilter();
      const highBandFilter = ctx.createBiquadFilter();
      const compressor = ctx.createDynamicsCompressor();
      const makeupGain = ctx.createGain();
      const output = ctx.createGain();
      lowBandFilter.type = 'lowpass';
      highBandFilter.type = 'highpass';
      input.connect(lowBandFilter);
      input.connect(highBandFilter);
      lowBandFilter.connect(output);
      highBandFilter.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(output);
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: 'de-esser',
        nodes: [input, lowBandFilter, highBandFilter, compressor, makeupGain, output],
        inputNode: input,
        outputNode: output,
        lowBandFilter,
        highBandFilter,
        compressor,
        makeupGain,
      };
      updateProcessorNode(ctx, node, processor);
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
      processor.type === 'polarity-invert' ||
      processor.type === 'mono-sum' ||
      processor.type === 'channel-swap' ||
      processor.type === 'stereo-split'
    ) {
      const scriptProcessor = ctx.createScriptProcessor(1024, 2, 2);
      const node: AudioRouteProcessorNode = {
        id: processor.id,
        type: processor.type,
        nodes: [scriptProcessor],
        scriptProcessor,
        sampleProcessor: processor,
      };
      attachSampleProcessor(node);
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    const compressor = ctx.createDynamicsCompressor();
    const makeupGain = ctx.createGain();
    const node: AudioRouteProcessorNode = {
      id: processor.id,
      type: 'compressor',
      nodes: [compressor, makeupGain],
      compressor,
      makeupGain,
    };
    updateProcessorNode(ctx, node, processor);
    return node;
  }

  private getRouteDynamicsSnapshot(
    route: { processorNodes: AudioRouteProcessorNode[] },
    updatedAt: number,
  ): Record<string, AudioDynamicsReductionSnapshot> | undefined {
    const dynamics: Record<string, AudioDynamicsReductionSnapshot> = {};

    for (const processor of route.processorNodes) {
      if ((processor.type === 'compressor' || processor.type === 'de-esser') && processor.compressor) {
        dynamics[processor.id] = {
          effectId: processor.id,
          processorType: processor.type,
          gainReductionDb: normalizeDynamicsReductionDb(processor.compressor.reduction),
          updatedAt,
        };
        continue;
      }

      if ((processor.type === 'limiter' || processor.type === 'noise-gate' || processor.type === 'expander' || processor.type === 'dynamic-eq-band') && processor.scriptProcessor) {
        dynamics[processor.id] = {
          effectId: processor.id,
          processorType: processor.type,
          gainReductionDb: normalizeDynamicsReductionDb(processor.gainReductionDb ?? 0),
          updatedAt,
        };
      }
    }

    return Object.keys(dynamics).length > 0 ? dynamics : undefined;
  }

  private updateRouteProcessors(
    route: AudioRoute,
    ctx: BaseAudioContext,
    processors: readonly LiveAudioRouteProcessor[],
  ): void {
    const signature = processorSignature(processors);
    if (signature !== route.lastProcessorSignature) {
      audioRoutingDebugCounters.routeProcessorRebuilds++;
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      route.processorNodes = processors.map(processor => this.createProcessorNode(ctx, processor));
      route.lastProcessorSignature = signature;
      this.reconnectRouteChain(route);
      return;
    }

    processors.forEach((processor, index) => {
      const node = route.processorNodes[index];
      if (node) updateProcessorNode(ctx, node, processor);
    });
  }

  private updateMasterRoute(
    ctx: AudioContext,
    settings: AudioRouteEffectSettings | undefined,
  ): void {
    const route = this.getOrCreateMasterRoute(ctx);
    const volume = settings?.volume ?? 1;
    const eqGains = settings?.eqGains ?? [];
    const processors = settings?.processors ?? [];

    if (Math.abs(route.lastVolume - volume) > 0.001) {
      route.gainNode.gain.value = Math.max(0, Math.min(4, volume));
      route.lastVolume = volume;
    }

    for (let index = 0; index < route.eqFilters.length; index += 1) {
      const gain = eqGains[index] ?? 0;
      if (Math.abs(route.lastEQGains[index] - gain) > 0.01) {
        route.eqFilters[index].gain.value = gain;
        route.lastEQGains[index] = gain;
      }
    }

    const signature = processorSignature(processors);
    if (signature !== route.lastProcessorSignature) {
      audioRoutingDebugCounters.masterProcessorRebuilds++;
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      route.processorNodes = processors.map(processor => this.createProcessorNode(ctx, processor));
      route.lastProcessorSignature = signature;
      this.reconnectMasterRouteChain(route);
      return;
    }

    processors.forEach((processor, index) => {
      const node = route.processorNodes[index];
      if (node) updateProcessorNode(ctx, node, processor);
    });
  }

  private reconnectRouteChain(route: AudioRoute): void {
    try {
      route.sourceNode.disconnect();
      route.gainNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.panNode.disconnect();
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Disconnecting a partially connected graph can throw; rebuild below.
    }

    let tail: AudioNode = route.gainNode;
    route.sourceNode.connect(route.gainNode);

    for (const processor of route.processorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectCustomProcessorInternal(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }

    tail.connect(route.eqFilters[0]);
    for (let i = 0; i < route.eqFilters.length - 1; i++) {
      route.eqFilters[i].connect(route.eqFilters[i + 1]);
    }
    route.eqFilters[route.eqFilters.length - 1].connect(route.panNode);
    route.panNode.connect(route.stereoSplitterNode);
    route.stereoSplitterNode.connect(route.leftAnalyserNode, 0);
    route.stereoSplitterNode.connect(route.rightAnalyserNode, 1);
    route.panNode.connect(route.analyserNode);
    route.analyserNode.connect(this.getOrCreateMasterRoute(this.audioContext!).inputNode);
    route.isConnected = true;
  }

  private reconnectMasterRouteChain(route: MasterAudioRoute): void {
    try {
      route.inputNode.disconnect();
      route.gainNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Disconnecting a partially connected graph can throw; rebuild below.
    }

    let tail: AudioNode = route.inputNode;

    for (const processor of route.processorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectCustomProcessorInternal(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }

    tail.connect(route.eqFilters[0]);
    for (let index = 0; index < route.eqFilters.length - 1; index += 1) {
      route.eqFilters[index].connect(route.eqFilters[index + 1]);
    }
    route.eqFilters[route.eqFilters.length - 1].connect(route.gainNode);
    route.gainNode.connect(route.stereoSplitterNode);
    route.stereoSplitterNode.connect(route.leftAnalyserNode, 0);
    route.stereoSplitterNode.connect(route.rightAnalyserNode, 1);
    route.gainNode.connect(route.analyserNode);
    route.analyserNode.connect(this.audioContext!.destination);
  }
}

// Singleton instance
export const audioRoutingManager = new AudioRoutingManager();
