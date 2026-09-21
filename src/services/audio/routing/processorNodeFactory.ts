import type { LiveAudioRouteProcessor } from '../audioGraphRouteSettings';
import { HUM_NOTCH_MAX_HARMONICS, updateProcessorNode } from './processorNodeUpdate';
import { attachSampleProcessor } from './processorSampleProcessing';
import type { AudioRouteProcessorNode, ProcessorNodeUpdateDeps } from './routeGraphTypes';

export function createProcessorNode(
  ctx: BaseAudioContext,
  processor: LiveAudioRouteProcessor,
  deps: ProcessorNodeUpdateDeps,
): AudioRouteProcessorNode {
  if (processor.type === 'pan') {
    const panner = ctx.createStereoPanner();
    const node: AudioRouteProcessorNode = {
      id: processor.id,
      type: 'pan',
      nodes: [panner],
      panner,
    };
    updateProcessorNode(ctx, node, processor, deps);
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
    updateProcessorNode(ctx, node, processor, deps);
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
    updateProcessorNode(ctx, node, processor, deps);
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
    updateProcessorNode(ctx, node, processor, deps);
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
    updateProcessorNode(ctx, node, processor, deps);
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
    updateProcessorNode(ctx, node, processor, deps);
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
    updateProcessorNode(ctx, node, processor, deps);
    return node;
  }

  if (
    processor.type === 'math-graph' || processor.type === 'limiter' ||
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
    updateProcessorNode(ctx, node, processor, deps);
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
  updateProcessorNode(ctx, node, processor, deps);
  return node;
}
