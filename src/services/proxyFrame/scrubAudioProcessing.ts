import { clampAudioPan, dbToLinearGain, finiteNumber } from '../../engine/audio/audioMath';
import type { SpectralGateState } from '../../engine/audio/spectralGateProcessor';
import type { AudioEqDynamicRuntimeState } from '../../engine/audio/eq/AudioEqDynamic';
import type { LiveAudioRouteProcessor } from '../audio/audioGraphRouteSettings';

export const HUM_NOTCH_MAX_HARMONICS = 8;

export interface ScrubProcessorNode {
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

export function scrubProcessorSignature(processors: readonly LiveAudioRouteProcessor[] = []): string {
  return processors.map(processor => `${processor.id}:${processor.type}`).join('|');
}

export function normalizeScrubDynamicsReductionDb(rawReduction: number): number {
  if (!Number.isFinite(rawReduction)) return 0;
  const reduction = rawReduction < 0 ? -rawReduction : rawReduction;
  return Math.max(0, Math.min(60, reduction));
}

export function updateScrubProcessorNode(
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
    ) &&
    node.scriptProcessor
  ) {
    node.sampleProcessor = processor;
  }
}

export function reconnectScrubCustomProcessor(node: ScrubProcessorNode): void {
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
