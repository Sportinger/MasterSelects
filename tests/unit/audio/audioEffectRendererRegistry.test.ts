import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEffectRenderer,
  EQ_BAND_PARAMS,
} from '../../../src/engine/audio/AudioEffectRenderer';
import { getAudioEffectParamNames } from '../../../src/engine/audio/AudioEffectRegistry';
import type { AnimatableProperty, AudioEffectInstance, Effect, Keyframe } from '../../../src/types';

type AudioEffectRendererRegistryTestAccess = AudioEffectRenderer & {
  getRenderableAudioEffects(effects: Effect[]): Effect[];
  hasEffectKeyframes(keyframes: Keyframe[], effectId: string): boolean;
  hasNonDefaultEQ(eqEffect: Effect): boolean;
  hasNonDefaultVolume(volumeEffect: Effect): boolean;
  shouldRenderAudioEffect(effect: Effect, keyframes: Keyframe[]): boolean;
  audioEffectInstanceToLegacyEffect(effect: AudioEffectInstance): Effect | null;
};

const globalWithOfflineContext = globalThis as typeof globalThis & {
  OfflineAudioContext?: typeof OfflineAudioContext;
};

const originalOfflineAudioContext = globalWithOfflineContext.OfflineAudioContext;

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

function makeKeyframe(effectId: string, paramName: string, value = 1): Keyframe {
  return {
    id: `kf-${effectId}-${paramName}`,
    clipId: 'clip-1',
    time: 0,
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
      id: 'delay-1',
      type: 'audio-delay',
      params: { mix: 1 },
    });

    expect(access.hasEffectKeyframes([
      makeKeyframe('vol-1', 'volume', 0.25),
    ], 'vol-1')).toBe(true);
    expect(access.shouldRenderAudioEffect(volume, [
      makeKeyframe('vol-1', 'volume', 0.25),
    ])).toBe(true);
    expect(access.shouldRenderAudioEffect(unknown, [
      makeKeyframe('delay-1', 'mix', 1),
    ])).toBe(false);
  });

  it('selects only registered legacy effects in renderer order', () => {
    const volume = makeEffect({
      id: 'vol-primary',
      type: 'audio-volume',
      params: { volume: 0.5 },
    });
    const eq = makeEffect({
      id: 'eq-primary',
      type: 'audio-eq',
      params: { band1k: 3 },
    });
    const unknown = makeEffect({
      id: 'delay-1',
      type: 'audio-delay',
      params: { mix: 1 },
    });
    const duplicateVolume = makeEffect({
      id: 'vol-secondary',
      type: 'audio-volume',
      params: { volume: 0.25 },
    });

    expect(access.getRenderableAudioEffects([
      unknown,
      volume,
      duplicateVolume,
      eq,
    ])).toEqual([eq, volume]);
  });

  it('returns the original buffer when registered effects are at defaults', async () => {
    const buffer = makeBuffer();
    const result = await renderer.renderEffects(buffer, [
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
    const unknownInstance: AudioEffectInstance = {
      id: 'unknown-instance',
      descriptorId: 'audio-delay',
      enabled: true,
      params: { mix: 1 },
    };

    expect(access.audioEffectInstanceToLegacyEffect(volumeInstance)).toEqual({
      id: 'volume-instance',
      name: 'Volume',
      type: 'audio-volume',
      enabled: true,
      params: { volume: 1 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(unknownInstance)).toBeNull();

    const result = await renderer.renderEffectInstances(buffer, [
      volumeInstance,
      unknownInstance,
    ], []);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('returns the original buffer for unknown effects even with params and keyframes', async () => {
    const buffer = makeBuffer();
    const result = await renderer.renderEffects(buffer, [
      makeEffect({ id: 'delay-1', type: 'audio-delay', params: { mix: 1 } }),
    ], [
      makeKeyframe('delay-1', 'mix', 1),
    ]);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });
});
