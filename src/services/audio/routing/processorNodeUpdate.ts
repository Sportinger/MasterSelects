import { clampAudioPan, dbToLinearGain, finiteNumber } from '../../../engine/audio/audioMath';
import type { LiveAudioRouteProcessor } from '../audioGraphRouteSettings';
import type { AudioRouteProcessorNode, ProcessorNodeUpdateDeps } from './routeGraphTypes';

export const HUM_NOTCH_MAX_HARMONICS = 8;

function clampFrequency(ctx: BaseAudioContext, value: number): number {
  const nyquist = Math.max(20, ctx.sampleRate / 2 - 1);
  return Math.max(10, Math.min(nyquist, finiteNumber(value, 1000)));
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

export function updateProcessorNode(
  ctx: BaseAudioContext,
  node: AudioRouteProcessorNode,
  processor: LiveAudioRouteProcessor,
  deps: ProcessorNodeUpdateDeps,
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
      node.convolver.buffer = deps.getOrCreateReverbImpulse(ctx, roomSize, decaySeconds, damping);
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
