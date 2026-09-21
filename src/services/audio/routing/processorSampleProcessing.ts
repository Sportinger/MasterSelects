import { processAudioMathBlock } from '../../../engine/audio/effectRender/audioMathBlock';
import {
  createAudioEqDynamicRuntimeState,
  createSingleBandAudioEqParams,
  processAudioEqChannels,
} from '../../../engine/audio/eq/AudioEqDynamic';
import { dbToLinearGain, finiteNumber } from '../../../engine/audio/audioMath';
import {
  createSpectralGateState,
  processSpectralGateBlock,
} from '../../../engine/audio/spectralGateProcessor';
import type { LiveAudioRouteProcessor } from '../audioGraphRouteSettings';
import { normalizeDynamicsReductionDb } from './dynamicsSnapshots';
import type { AudioRouteProcessorNode } from './routeGraphTypes';

function limiterReductionDb(inputLinear: number, outputLinear: number): number {
  if (inputLinear <= 0 || outputLinear <= 0 || outputLinear >= inputLinear) return 0;
  return normalizeDynamicsReductionDb(20 * Math.log10(inputLinear / outputLinear));
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

function calculateExpanderTargetGain(
  sample: number,
  processor: Extract<LiveAudioRouteProcessor, { type: 'expander' }>,
): number {
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

export function attachSampleProcessor(node: AudioRouteProcessorNode): void {
  const scriptProcessor = node.scriptProcessor;
  if (!scriptProcessor) return;
  scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
    const processor = node.sampleProcessor;
    if (processor?.type === 'math-graph') {
      processAudioMathBlock(processor.program, event.inputBuffer, event.outputBuffer);
      return;
    }
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
