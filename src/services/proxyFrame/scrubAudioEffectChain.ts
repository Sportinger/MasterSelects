import { clampAudioPan } from '../../engine/audio/audioMath';
import type { LiveAudioRouteProcessor } from '../audio/audioGraphRouteSettings';
import { attachScrubSampleProcessor } from './scrubAudioSampleProcessors';
import {
  HUM_NOTCH_MAX_HARMONICS,
  normalizeScrubDynamicsReductionDb,
  reconnectScrubCustomProcessor,
  updateScrubProcessorNode,
  type ScrubProcessorNode,
} from './scrubAudioProcessing';

const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

interface ScrubDynamicsReductionSnapshot {
  effectId: string;
  processorType: 'compressor' | 'de-esser' | 'limiter' | 'noise-gate' | 'expander' | 'dynamic-eq-band';
  gainReductionDb: number;
  updatedAt: number;
}

export class ScrubAudioEffectChain {
  private sourceGain: GainNode | null = null;
  private panNode: StereoPannerNode | null = null;
  private stereoSplitter: ChannelSplitterNode | null = null;
  private leftAnalyser: AnalyserNode | null = null;
  private rightAnalyser: AnalyserNode | null = null;
  private leftMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private rightMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private processorNodes: ScrubProcessorNode[] = [];
  private processorSignature = '';

  get sourceGainNode(): GainNode | null {
    return this.sourceGain;
  }

  get signature(): string {
    return this.processorSignature;
  }

  attach(
    ctx: AudioContext,
    outputAnalyser: AnalyserNode,
    volume: number,
    eqGains: number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[],
    processorSignature: string,
  ): void {
    this.sourceGain = ctx.createGain();
    this.sourceGain.gain.value = volume;
    this.panNode = ctx.createStereoPanner();
    this.panNode.pan.value = pan;
    this.stereoSplitter = ctx.createChannelSplitter(2);
    this.leftAnalyser = ctx.createAnalyser();
    this.rightAnalyser = ctx.createAnalyser();
    this.leftAnalyser.fftSize = outputAnalyser.fftSize;
    this.rightAnalyser.fftSize = outputAnalyser.fftSize;
    this.leftAnalyser.smoothingTimeConstant = outputAnalyser.smoothingTimeConstant;
    this.rightAnalyser.smoothingTimeConstant = outputAnalyser.smoothingTimeConstant;
    this.leftMeterBuffer = new Float32Array(this.leftAnalyser.fftSize);
    this.rightMeterBuffer = new Float32Array(this.rightAnalyser.fftSize);
    this.processorNodes = processors.map(processor => this.createScrubProcessorNode(ctx, processor));
    this.processorSignature = processorSignature;

    this.eqFilters = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.4;
      filter.gain.value = eqGains[index] ?? 0;
      return filter;
    });

    let tail: AudioNode = this.sourceGain;
    for (const processor of this.processorNodes) {
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
    tail.connect(this.eqFilters[0]);
    for (let i = 0; i < this.eqFilters.length - 1; i++) {
      this.eqFilters[i].connect(this.eqFilters[i + 1]);
    }
    this.eqFilters[this.eqFilters.length - 1].connect(this.panNode);
    this.panNode.connect(this.stereoSplitter);
    this.stereoSplitter.connect(this.leftAnalyser, 0);
    this.stereoSplitter.connect(this.rightAnalyser, 1);
    this.panNode.connect(outputAnalyser);
  }

  update(
    ctx: AudioContext,
    volume: number,
    eqGains: number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[],
  ): void {
    if (this.sourceGain) {
      this.sourceGain.gain.value = Math.max(0, Math.min(4, volume));
    }
    if (this.panNode) {
      this.panNode.pan.value = clampAudioPan(pan);
    }

    for (let i = 0; i < this.eqFilters.length; i++) {
      this.eqFilters[i].gain.value = eqGains[i] ?? 0;
    }

    processors.forEach((processor, index) => {
      const node = this.processorNodes[index];
      if (node) updateScrubProcessorNode(ctx, node, processor);
    });
  }

  disconnect(): void {
    if (this.sourceGain) {
      try {
        this.sourceGain.disconnect();
      } catch { /* ignore */ }
      this.sourceGain = null;
    }
    if (this.panNode) {
      try {
        this.panNode.disconnect();
      } catch { /* ignore */ }
      this.panNode = null;
    }
    if (this.stereoSplitter) {
      try {
        this.stereoSplitter.disconnect();
      } catch { /* ignore */ }
      this.stereoSplitter = null;
    }
    if (this.leftAnalyser) {
      try {
        this.leftAnalyser.disconnect();
      } catch { /* ignore */ }
      this.leftAnalyser = null;
    }
    if (this.rightAnalyser) {
      try {
        this.rightAnalyser.disconnect();
      } catch { /* ignore */ }
      this.rightAnalyser = null;
    }
    this.leftMeterBuffer = null;
    this.rightMeterBuffer = null;
    for (const processor of this.processorNodes) {
      for (const node of processor.nodes) {
        try {
          node.disconnect();
        } catch { /* ignore */ }
      }
    }
    for (const filter of this.eqFilters) {
      try {
        filter.disconnect();
      } catch { /* ignore */ }
    }
    this.processorNodes = [];
    this.processorSignature = '';
    this.eqFilters = [];
  }

  readStereoMeterSamples(): { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> } | undefined {
    const leftAnalyser = this.leftAnalyser;
    const rightAnalyser = this.rightAnalyser;
    const leftMeterBuffer = this.leftMeterBuffer;
    const rightMeterBuffer = this.rightMeterBuffer;

    if (leftAnalyser && rightAnalyser && leftMeterBuffer && rightMeterBuffer) {
      leftAnalyser.getFloatTimeDomainData(leftMeterBuffer);
      rightAnalyser.getFloatTimeDomainData(rightMeterBuffer);
      return { left: leftMeterBuffer, right: rightMeterBuffer };
    }

    return undefined;
  }

  getDynamicsSnapshot(updatedAt: number): Record<string, ScrubDynamicsReductionSnapshot> | undefined {
    const dynamics: Record<string, ScrubDynamicsReductionSnapshot> = {};

    for (const processor of this.processorNodes) {
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
      processor.type === 'math-graph' || processor.type === 'limiter' ||
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
}
