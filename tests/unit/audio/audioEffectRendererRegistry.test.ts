import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEffectRenderer,
  EQ_BAND_PARAMS,
} from '../../../src/engine/audio/AudioEffectRenderer';
import { getAudioEffectParamNames } from '../../../src/engine/audio/AudioEffectRegistry';
import type { AnimatableProperty, AudioEffectInstance, Effect, Keyframe } from '../../../src/types';

type AudioEffectRendererRegistryTestAccess = AudioEffectRenderer & {
  getRenderableAudioEffects(effects: Effect[]): Effect[];
  getRenderableAudioEffectInstances(effectStack: readonly AudioEffectInstance[]): AudioEffectInstance[];
  hasEffectKeyframes(keyframes: Keyframe[], effectId: string): boolean;
  hasNonDefaultEQ(eqEffect: Effect): boolean;
  hasNonDefaultVolume(volumeEffect: Effect): boolean;
  shouldRenderAudioEffect(effect: Effect, keyframes: Keyframe[]): boolean;
  shouldRenderAudioEffectInstance(effect: AudioEffectInstance, keyframes: Keyframe[]): boolean;
  audioEffectInstanceToLegacyEffect(effect: AudioEffectInstance): Effect | null;
};

const globalWithOfflineContext = globalThis as typeof globalThis & {
  OfflineAudioContext?: typeof OfflineAudioContext;
  AudioContext?: typeof AudioContext;
};

const originalOfflineAudioContext = globalWithOfflineContext.OfflineAudioContext;
const originalAudioContext = globalWithOfflineContext.AudioContext;

function asRegistryTestAccess(
  renderer: AudioEffectRenderer
): AudioEffectRendererRegistryTestAccess {
  return renderer as unknown as AudioEffectRendererRegistryTestAccess;
}

function makeEffect(options: {
  id: string;
  type: string;
  params?: Effect['params'];
  enabled?: boolean;
}): Effect {
  return {
    id: options.id,
    name: options.type,
    type: options.type as Effect['type'],
    enabled: options.enabled ?? true,
    params: options.params ?? {},
  };
}

function makeKeyframe(effectId: string, paramName: string, value = 1, time = 0): Keyframe {
  return {
    id: `kf-${effectId}-${paramName}-${time}`,
    clipId: 'clip-1',
    time,
    property: `effect.${effectId}.${paramName}` as AnimatableProperty,
    value,
    easing: 'linear',
  };
}

function makeBuffer(): AudioBuffer {
  return {
    numberOfChannels: 1,
    sampleRate: 48000,
    length: 480,
    duration: 0.01,
  } as AudioBuffer;
}

function makeMutableBuffer(samples: number[], sampleRate = 48000): AudioBuffer {
  const channelData = [Float32Array.from(samples)];
  return {
    numberOfChannels: 1,
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function makeMultiChannelBuffer(channels: number[][], sampleRate = 48000): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;
  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function installAudioContextMock(): void {
  class AudioContextMock {
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
      const channelData = Array.from({ length: numberOfChannels }, () => Float32Array.from(Array.from({ length }, () => 0)));
      return {
        numberOfChannels,
        sampleRate,
        length,
        duration: length / sampleRate,
        getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
      } as unknown as AudioBuffer;
    }

    close(): void {}
  }

  globalWithOfflineContext.AudioContext = AudioContextMock as unknown as typeof AudioContext;
}

describe('AudioEffectRenderer registry migration', () => {
  let renderer: AudioEffectRenderer;
  let access: AudioEffectRendererRegistryTestAccess;
  let offlineContextConstructor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renderer = new AudioEffectRenderer();
    access = asRegistryTestAccess(renderer);
    offlineContextConstructor = vi.fn(() => {
      throw new Error('OfflineAudioContext should not be constructed for no-op registry cases');
    });
    globalWithOfflineContext.OfflineAudioContext =
      offlineContextConstructor as unknown as typeof OfflineAudioContext;
  });

  afterEach(() => {
    if (originalOfflineAudioContext) {
      globalWithOfflineContext.OfflineAudioContext = originalOfflineAudioContext;
    } else {
      Reflect.deleteProperty(globalWithOfflineContext, 'OfflineAudioContext');
    }
    if (originalAudioContext) {
      globalWithOfflineContext.AudioContext = originalAudioContext;
    } else {
      Reflect.deleteProperty(globalWithOfflineContext, 'AudioContext');
    }
  });

  it('exports EQ band params from the audio effect registry', () => {
    expect(EQ_BAND_PARAMS).toEqual(getAudioEffectParamNames('audio-eq'));
  });

  it('treats missing params as registry defaults', () => {
    expect(access.hasNonDefaultVolume(makeEffect({
      id: 'vol-1',
      type: 'audio-volume',
      params: {},
    }))).toBe(false);

    expect(access.hasNonDefaultEQ(makeEffect({
      id: 'eq-1',
      type: 'audio-eq',
      params: {},
    }))).toBe(false);
  });

  it('detects non-default registry-backed volume and EQ params', () => {
    expect(access.hasNonDefaultVolume(makeEffect({
      id: 'vol-1',
      type: 'audio-volume',
      params: { volume: 0.5 },
    }))).toBe(true);

    expect(access.hasNonDefaultEQ(makeEffect({
      id: 'eq-1',
      type: 'audio-eq',
      params: { band1k: 0.009 },
    }))).toBe(false);

    expect(access.hasNonDefaultEQ(makeEffect({
      id: 'eq-1',
      type: 'audio-eq',
      params: { band1k: 0.011 },
    }))).toBe(true);
  });

  it('detects keyframes for registered effects but not unknown effects', () => {
    const volume = makeEffect({ id: 'vol-1', type: 'audio-volume' });
    const unknown = makeEffect({
      id: 'phaser-1',
      type: 'audio-phaser',
      params: { mix: 1 },
    });

    expect(access.hasEffectKeyframes([
      makeKeyframe('vol-1', 'volume', 0.25),
    ], 'vol-1')).toBe(true);
    expect(access.shouldRenderAudioEffect(volume, [
      makeKeyframe('vol-1', 'volume', 0.25),
    ])).toBe(true);
    expect(access.shouldRenderAudioEffect(unknown, [
      makeKeyframe('phaser-1', 'mix', 1),
    ])).toBe(false);
  });

  it('detects non-default professional registry-backed params', () => {
    const highPass = makeEffect({
      id: 'hp-1',
      type: 'audio-high-pass',
      params: { frequencyHz: 120, q: 0.707 },
    });
    const pan = makeEffect({
      id: 'pan-1',
      type: 'audio-pan',
      params: { pan: 0.4 },
    });
    const parametric = makeEffect({
      id: 'parametric-1',
      type: 'audio-parametric-eq',
      params: { frequencyHz: 2400, gainDb: -3, q: 1.2 },
    });
    const defaultLimiter: AudioEffectInstance = {
      id: 'limiter-1',
      descriptorId: 'audio-limiter',
      enabled: true,
      params: {},
    };
    const activeLimiter: AudioEffectInstance = {
      ...defaultLimiter,
      params: { ceilingDb: -1, inputGainDb: 3 },
    };
    const defaultExpander: AudioEffectInstance = {
      id: 'expander-1',
      descriptorId: 'audio-expander',
      enabled: true,
      params: {},
    };
    const activeExpander: AudioEffectInstance = {
      ...defaultExpander,
      params: { thresholdDb: -35, ratio: 2, rangeDb: 18 },
    };
    const deEsser: AudioEffectInstance = {
      id: 'de-esser-1',
      descriptorId: 'audio-de-esser',
      enabled: true,
      params: { frequencyHz: 7200, thresholdDb: -24, ratio: 4, kneeDb: 6, attackMs: 1, releaseMs: 90 },
    };
    const humNotch: AudioEffectInstance = {
      id: 'hum-notch-1',
      descriptorId: 'audio-hum-notch',
      enabled: true,
      params: {},
    };
    const deClick: AudioEffectInstance = {
      id: 'de-click-1',
      descriptorId: 'audio-de-click',
      enabled: true,
      params: {},
    };
    const defaultNoiseReduction: AudioEffectInstance = {
      id: 'noise-reduction-1',
      descriptorId: 'audio-noise-reduction',
      enabled: true,
      params: {},
    };
    const activeNoiseReduction: AudioEffectInstance = {
      ...defaultNoiseReduction,
      params: { thresholdDb: -58, reductionDb: 18, sensitivity: 1.6, attackMs: 6, releaseMs: 180, mix: 0.7 },
    };
    const saturation: AudioEffectInstance = {
      id: 'saturation-1',
      descriptorId: 'audio-saturation',
      enabled: true,
      params: { driveDb: 12, toneHz: 12000, mix: 0.7 },
    };
    const polarity: AudioEffectInstance = {
      id: 'polarity-1',
      descriptorId: 'audio-polarity-invert',
      enabled: true,
      params: { channelMode: 'all' },
    };
    const monoSum: AudioEffectInstance = {
      id: 'mono-1',
      descriptorId: 'audio-mono-sum',
      enabled: true,
      params: {},
    };
    const stereoSplit: AudioEffectInstance = {
      id: 'stereo-split-1',
      descriptorId: 'audio-stereo-split',
      enabled: true,
      params: {},
    };

    expect(access.shouldRenderAudioEffect(highPass, [])).toBe(true);
    expect(access.shouldRenderAudioEffect(pan, [])).toBe(true);
    expect(access.shouldRenderAudioEffect(parametric, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(defaultLimiter, [])).toBe(false);
    expect(access.shouldRenderAudioEffectInstance(activeLimiter, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(defaultExpander, [])).toBe(false);
    expect(access.shouldRenderAudioEffectInstance(activeExpander, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(deEsser, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(humNotch, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(deClick, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(defaultNoiseReduction, [])).toBe(false);
    expect(access.shouldRenderAudioEffectInstance(activeNoiseReduction, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(saturation, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(polarity, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(monoSum, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(stereoSplit, [])).toBe(true);
  });

  it('selects only registered legacy effects in renderer order', () => {
    const volume = makeEffect({
      id: 'vol-primary',
      type: 'audio-volume',
      params: { volume: 0.5 },
    });
    const pan = makeEffect({
      id: 'pan-primary',
      type: 'audio-pan',
      params: { pan: -0.4 },
    });
    const eq = makeEffect({
      id: 'eq-primary',
      type: 'audio-eq',
      params: { band1k: 3 },
    });
    const parametric = makeEffect({
      id: 'parametric-1',
      type: 'audio-parametric-eq',
      params: { gainDb: -4 },
    });
    const humNotch = makeEffect({
      id: 'hum-notch-1',
      type: 'audio-hum-notch',
      params: {},
    });
    const deClick = makeEffect({
      id: 'de-click-1',
      type: 'audio-de-click',
      params: {},
    });
    const noiseReduction = makeEffect({
      id: 'noise-reduction-1',
      type: 'audio-noise-reduction',
      params: { thresholdDb: -58, reductionDb: 18, sensitivity: 1.6, mix: 0.7 },
    });
    const delay = makeEffect({
      id: 'delay-1',
      type: 'audio-delay',
      params: { mix: 1 },
    });
    const expander = makeEffect({
      id: 'expander-1',
      type: 'audio-expander',
      params: { thresholdDb: -35, ratio: 2, rangeDb: 18 },
    });
    const saturation = makeEffect({
      id: 'saturation-1',
      type: 'audio-saturation',
      params: { driveDb: 12, mix: 1 },
    });
    const polarity = makeEffect({
      id: 'polarity-1',
      type: 'audio-polarity-invert',
      params: { channelMode: 'all' },
    });
    const stereoSplit = makeEffect({
      id: 'stereo-split-1',
      type: 'audio-stereo-split',
      params: { sourceChannel: 1 },
    });
    const deEsser = makeEffect({
      id: 'de-esser-1',
      type: 'audio-de-esser',
      params: { thresholdDb: -24, ratio: 4 },
    });
    const duplicateVolume = makeEffect({
      id: 'vol-secondary',
      type: 'audio-volume',
      params: { volume: 0.25 },
    });

    expect(access.getRenderableAudioEffects([
      delay,
      deEsser,
      volume,
      duplicateVolume,
      saturation,
      polarity,
      parametric,
      humNotch,
      deClick,
      noiseReduction,
      stereoSplit,
      pan,
      expander,
      eq,
    ])).toEqual([humNotch, deClick, noiseReduction, eq, parametric, deEsser, expander, delay, saturation, polarity, stereoSplit, pan, volume]);
  });

  it('returns the original buffer when registered effects are at defaults', async () => {
    const buffer = makeBuffer();
    const result = await renderer.renderEffects(buffer, [
      makeEffect({ id: 'pan-1', type: 'audio-pan', params: {} }),
      makeEffect({ id: 'vol-1', type: 'audio-volume', params: {} }),
      makeEffect({ id: 'eq-1', type: 'audio-eq', params: {} }),
    ], []);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('skips disabled registered legacy effects even when their params are non-default', async () => {
    const buffer = makeBuffer();
    const disabledVolume = makeEffect({
      id: 'vol-disabled',
      type: 'audio-volume',
      enabled: false,
      params: { volume: 0.1 },
    });

    const result = await renderer.renderEffects(buffer, [disabledVolume], [
      makeKeyframe('vol-disabled', 'volume', 0.25),
    ]);

    expect(access.shouldRenderAudioEffect(disabledVolume, [
      makeKeyframe('vol-disabled', 'volume', 0.25),
    ])).toBe(false);
    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('converts new audio effect instances through registry descriptors', async () => {
    const buffer = makeBuffer();
    const volumeInstance: AudioEffectInstance = {
      id: 'volume-instance',
      descriptorId: 'audio-volume',
      enabled: true,
      params: { volume: 1 },
      automationMode: 'clip',
    };
    const panInstance: AudioEffectInstance = {
      id: 'pan-instance',
      descriptorId: 'audio-pan',
      enabled: true,
      params: { pan: -0.5 },
      automationMode: 'clip',
    };
    const unknownInstance: AudioEffectInstance = {
      id: 'unknown-instance',
      descriptorId: 'audio-phaser',
      enabled: true,
      params: { mix: 1 },
    };
    const delayInstance: AudioEffectInstance = {
      id: 'delay-instance',
      descriptorId: 'audio-delay',
      enabled: true,
      params: { mix: 0 },
    };
    const compressorInstance: AudioEffectInstance = {
      id: 'compressor-instance',
      descriptorId: 'audio-compressor',
      enabled: true,
      params: { thresholdDb: -18, ratio: 3 },
    };
    const deEsserInstance: AudioEffectInstance = {
      id: 'de-esser-instance',
      descriptorId: 'audio-de-esser',
      enabled: true,
      params: { frequencyHz: 7000, thresholdDb: -24, ratio: 4 },
    };
    const expanderInstance: AudioEffectInstance = {
      id: 'expander-instance',
      descriptorId: 'audio-expander',
      enabled: true,
      params: { thresholdDb: -35, ratio: 2.5, rangeDb: 18, attackMs: 3, releaseMs: 110 },
    };
    const humNotchInstance: AudioEffectInstance = {
      id: 'hum-notch-instance',
      descriptorId: 'audio-hum-notch',
      enabled: true,
      params: { frequencyHz: 60, q: 25, harmonics: 3, mix: 0.8 },
    };
    const deClickInstance: AudioEffectInstance = {
      id: 'de-click-instance',
      descriptorId: 'audio-de-click',
      enabled: true,
      params: { threshold: 0.3, ratio: 5, mix: 0.75 },
    };
    const noiseReductionInstance: AudioEffectInstance = {
      id: 'noise-reduction-instance',
      descriptorId: 'audio-noise-reduction',
      enabled: true,
      params: { thresholdDb: -58, reductionDb: 18, sensitivity: 1.6, attackMs: 6, releaseMs: 180, mix: 0.7 },
    };
    const saturationInstance: AudioEffectInstance = {
      id: 'saturation-instance',
      descriptorId: 'audio-saturation',
      enabled: true,
      params: { driveDb: 9, mix: 0.5 },
    };
    const monoInstance: AudioEffectInstance = {
      id: 'mono-instance',
      descriptorId: 'audio-mono-sum',
      enabled: true,
      params: {},
    };
    const stereoSplitInstance: AudioEffectInstance = {
      id: 'stereo-split-instance',
      descriptorId: 'audio-stereo-split',
      enabled: true,
      params: { sourceChannel: 1 },
    };

    expect(access.audioEffectInstanceToLegacyEffect(volumeInstance)).toEqual({
      id: 'volume-instance',
      name: 'Volume',
      type: 'audio-volume',
      enabled: true,
      params: { volume: 1 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(panInstance)).toEqual({
      id: 'pan-instance',
      name: 'Pan',
      type: 'audio-pan',
      enabled: true,
      params: { pan: -0.5 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(unknownInstance)).toBeNull();
    expect(access.audioEffectInstanceToLegacyEffect(delayInstance)).toEqual({
      id: 'delay-instance',
      name: 'Delay',
      type: 'audio-delay',
      enabled: true,
      params: { mix: 0 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(compressorInstance)).toEqual({
      id: 'compressor-instance',
      name: 'Compressor',
      type: 'audio-compressor',
      enabled: true,
      params: { thresholdDb: -18, ratio: 3 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(deEsserInstance)).toEqual({
      id: 'de-esser-instance',
      name: 'De-esser',
      type: 'audio-de-esser',
      enabled: true,
      params: { frequencyHz: 7000, thresholdDb: -24, ratio: 4 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(expanderInstance)).toEqual({
      id: 'expander-instance',
      name: 'Expander',
      type: 'audio-expander',
      enabled: true,
      params: { thresholdDb: -35, ratio: 2.5, rangeDb: 18, attackMs: 3, releaseMs: 110 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(humNotchInstance)).toEqual({
      id: 'hum-notch-instance',
      name: 'Hum Notch',
      type: 'audio-hum-notch',
      enabled: true,
      params: { frequencyHz: 60, q: 25, harmonics: 3, mix: 0.8 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(deClickInstance)).toEqual({
      id: 'de-click-instance',
      name: 'De-click',
      type: 'audio-de-click',
      enabled: true,
      params: { threshold: 0.3, ratio: 5, mix: 0.75 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(noiseReductionInstance)).toEqual({
      id: 'noise-reduction-instance',
      name: 'Noise Reduction',
      type: 'audio-noise-reduction',
      enabled: true,
      params: { thresholdDb: -58, reductionDb: 18, sensitivity: 1.6, attackMs: 6, releaseMs: 180, mix: 0.7 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(saturationInstance)).toEqual({
      id: 'saturation-instance',
      name: 'Saturation',
      type: 'audio-saturation',
      enabled: true,
      params: { driveDb: 9, mix: 0.5 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(monoInstance)).toEqual({
      id: 'mono-instance',
      name: 'Mono Sum',
      type: 'audio-mono-sum',
      enabled: true,
      params: {},
    });
    expect(access.audioEffectInstanceToLegacyEffect(stereoSplitInstance)).toEqual({
      id: 'stereo-split-instance',
      name: 'Stereo Split',
      type: 'audio-stereo-split',
      enabled: true,
      params: { sourceChannel: 1 },
    });

    const result = await renderer.renderEffectInstances(buffer, [
      volumeInstance,
      unknownInstance,
    ], []);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('renders pure sample audio effect instances without constructing an offline node graph', async () => {
    installAudioContextMock();
    const buffer = makeMutableBuffer([0.02, 0.5, -0.95, 0.01, -0.02, 0, 0, 0, 0, 0], 1000);

    const limited = await renderer.renderEffectInstances(buffer, [{
      id: 'limiter-1',
      descriptorId: 'audio-limiter',
      enabled: true,
      params: { ceilingDb: -6, inputGainDb: 0 },
    }], []);

    expect(limited).not.toBe(buffer);
    expect(Math.max(...Array.from(limited.getChannelData(0)).map(Math.abs))).toBeLessThanOrEqual(0.502);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const gated = await renderer.renderEffectInstances(buffer, [{
      id: 'gate-1',
      descriptorId: 'audio-noise-gate',
      enabled: true,
      params: { thresholdDb: -20, floorDb: -80, attackMs: 0.1, releaseMs: 0.1 },
    }], []);

    expect(gated.getChannelData(0)[0]).toBeLessThan(buffer.getChannelData(0)[0]);
    expect(Math.abs(gated.getChannelData(0)[2])).toBeGreaterThan(0.5);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const expanded = await renderer.renderEffectInstances(
      makeMutableBuffer([0.01, 1], 1000),
      [{
        id: 'expander-1',
        descriptorId: 'audio-expander',
        enabled: true,
        params: { thresholdDb: -20, ratio: 2, rangeDb: 24, attackMs: 0.001, releaseMs: 0.001 },
      }],
      [],
    );

    expect(expanded.getChannelData(0)[0]).toBeLessThan(0.002);
    expect(expanded.getChannelData(0)[1]).toBeGreaterThan(0.9);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const delayed = await renderer.renderEffectInstances(buffer, [{
      id: 'delay-1',
      descriptorId: 'audio-delay',
      enabled: true,
      params: { delayMs: 2, feedback: 0, mix: 1 },
    }], []);

    expect(delayed.getChannelData(0)[0]).toBeCloseTo(0);
    expect(delayed.getChannelData(0)[2]).toBeCloseTo(buffer.getChannelData(0)[0]);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const reverbed = await renderer.renderEffectInstances(buffer, [{
      id: 'reverb-1',
      descriptorId: 'audio-reverb',
      enabled: true,
      params: { roomSize: 0, decaySeconds: 0.2, damping: 0.2, mix: 1 },
    }], []);
    const wetTailEnergy = Array.from(reverbed.getChannelData(0))
      .slice(1)
      .reduce((sum, sample) => sum + Math.abs(sample), 0);

    expect(wetTailEnergy).toBeGreaterThan(0);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const saturated = await renderer.renderEffectInstances(
      makeMutableBuffer([0.1, 0.35, 0.8, -0.8], 1000),
      [{
        id: 'saturation-1',
        descriptorId: 'audio-saturation',
        enabled: true,
        params: { driveDb: 18, toneHz: 20000, mix: 1 },
      }],
      [],
    );

    expect(saturated.getChannelData(0)[0]).toBeGreaterThan(0.1);
    expect(saturated.getChannelData(0)[2]).toBeLessThanOrEqual(1);
    expect(saturated.getChannelData(0)[3]).toBeGreaterThanOrEqual(-1);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const deClicked = await renderer.renderEffectInstances(
      makeMutableBuffer([0, 0, 1, 0, 0], 1000),
      [{
        id: 'de-click-1',
        descriptorId: 'audio-de-click',
        enabled: true,
        params: { threshold: 0.2, ratio: 2, mix: 1 },
      }],
      [],
    );

    expect(deClicked.getChannelData(0)[2]).toBeCloseTo(0, 5);
    expect(Array.from(deClicked.getChannelData(0))).toEqual([0, 0, 0, 0, 0]);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const denoised = await renderer.renderEffectInstances(
      makeMutableBuffer([0.01, 0.01, 0.8], 1000),
      [{
        id: 'noise-reduction-1',
        descriptorId: 'audio-noise-reduction',
        enabled: true,
        params: { thresholdDb: -20, reductionDb: 24, sensitivity: 4, attackMs: 0.001, releaseMs: 0.001, mix: 1 },
      }],
      [],
    );

    expect(Math.abs(denoised.getChannelData(0)[0])).toBeLessThan(0.001);
    expect(Math.abs(denoised.getChannelData(0)[1])).toBeLessThan(0.001);
    expect(denoised.getChannelData(0)[2]).toBeGreaterThan(0.75);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const stereo = makeMultiChannelBuffer([
      [0.25, -0.5],
      [0.75, 0.25],
    ]);
    const invertedLeft = await renderer.renderEffectInstances(stereo, [{
      id: 'polarity-1',
      descriptorId: 'audio-polarity-invert',
      enabled: true,
      params: { channelMode: 'left' },
    }], []);
    expect(Array.from(invertedLeft.getChannelData(0))).toEqual([-0.25, 0.5]);
    expect(Array.from(invertedLeft.getChannelData(1))).toEqual([0.75, 0.25]);

    const mono = await renderer.renderEffectInstances(stereo, [{
      id: 'mono-1',
      descriptorId: 'audio-mono-sum',
      enabled: true,
      params: {},
    }], []);
    expect(Array.from(mono.getChannelData(0))).toEqual([0.5, -0.125]);
    expect(Array.from(mono.getChannelData(1))).toEqual([0.5, -0.125]);

    const swapped = await renderer.renderEffectInstances(stereo, [{
      id: 'swap-1',
      descriptorId: 'audio-channel-swap',
      enabled: true,
      params: {},
    }], []);
    expect(Array.from(swapped.getChannelData(0))).toEqual([0.75, 0.25]);
    expect(Array.from(swapped.getChannelData(1))).toEqual([0.25, -0.5]);

    const splitRight = await renderer.renderEffectInstances(stereo, [{
      id: 'stereo-split-1',
      descriptorId: 'audio-stereo-split',
      enabled: true,
      params: { sourceChannel: 1 },
    }], []);
    expect(Array.from(splitRight.getChannelData(0))).toEqual([0.75, 0.25]);
    expect(Array.from(splitRight.getChannelData(1))).toEqual([0.75, 0.25]);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('applies sample-domain audio effect keyframes during offline rendering', async () => {
    installAudioContextMock();
    const buffer = makeMutableBuffer([0.8, 0.8, 0.8, 0.8, 0.8, 0.8], 10);

    const limited = await renderer.renderEffectInstances(buffer, [{
      id: 'limiter-automated',
      descriptorId: 'audio-limiter',
      enabled: true,
      params: {},
    }], [
      makeKeyframe('limiter-automated', 'ceilingDb', -20, 0),
      makeKeyframe('limiter-automated', 'ceilingDb', -1, 0.3),
    ]);

    expect(limited).not.toBe(buffer);
    expect(limited.getChannelData(0)[0]).toBeLessThanOrEqual(0.101);
    expect(limited.getChannelData(0)[5]).toBeGreaterThan(0.7);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const delayed = await renderer.renderEffectInstances(
      makeMutableBuffer([1, 0, 0, 0], 1000),
      [{
        id: 'delay-automated',
        descriptorId: 'audio-delay',
        enabled: true,
        params: { delayMs: 1, feedback: 0 },
      }],
      [
        makeKeyframe('delay-automated', 'mix', 1, 0),
      ],
    );

    expect(delayed.getChannelData(0)[0]).toBeCloseTo(0, 3);
    expect(delayed.getChannelData(0)[1]).toBeGreaterThan(0.95);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('returns the original buffer for unknown effects even with params and keyframes', async () => {
    const buffer = makeBuffer();
    const result = await renderer.renderEffects(buffer, [
      makeEffect({ id: 'phaser-1', type: 'audio-phaser', params: { mix: 1 } }),
    ], [
      makeKeyframe('phaser-1', 'mix', 1),
    ]);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });
});
