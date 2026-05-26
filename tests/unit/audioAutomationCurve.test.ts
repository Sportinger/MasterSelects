import { describe, expect, it } from 'vitest';
import { resolveAudioVolumeAutomationCurveKeyframes } from '../../src/components/timeline/utils/audioAutomationCurve';
import type { Effect, Keyframe } from '../../src/types';
import type { AudioEffectInstance } from '../../src/types/audio';

type TestAudioEffectInstance = AudioEffectInstance & {
  bypassed?: boolean;
};

function keyframe(id: string, property: string, time: number, value: number): Keyframe {
  return {
    id,
    clipId: 'clip-a',
    property: property as Keyframe['property'],
    time,
    value,
    easing: 'linear',
  };
}

describe('audioAutomationCurve', () => {
  it('extracts sorted legacy audio-volume keyframes for timeline overlay curves', () => {
    const legacyEffects: Effect[] = [
      { id: 'vol', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 1 } },
      { id: 'eq', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 0 } },
    ];

    expect(resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: [
        keyframe('b', 'effect.vol.volume', 1, 1),
        keyframe('ignored-eq', 'effect.eq.band1k', 0.5, 3),
        keyframe('a', 'effect.vol.volume', 0, 0),
      ],
      legacyEffects,
      clipDuration: 2,
    }).map(point => [point.id, point.time, point.value])).toEqual([
      ['a', 0, 0],
      ['b', 1, 1],
    ]);
  });

  it('supports registry audio-volume automation and clamps display gain to the curve bounds', () => {
    const audioEffectStack: AudioEffectInstance[] = [
      { id: 'reg-vol', descriptorId: 'audio-volume', enabled: true, params: { volume: 1 }, automationMode: 'write' },
    ];

    expect(resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: [
        keyframe('quiet', 'effect.reg-vol.volume', 0, -1),
        keyframe('loud', 'effect.reg-vol.volume', 1, 2.5),
      ],
      audioEffectStack,
      clipDuration: 2,
    }).map(point => point.value)).toEqual([0, 1]);
  });

  it('ignores disabled volume effects and out-of-range keyframes', () => {
    const legacyEffects: Effect[] = [
      { id: 'disabled-vol', name: 'Volume', type: 'audio-volume', enabled: false, params: { volume: 1 } },
    ];
    const audioEffectStack: TestAudioEffectInstance[] = [
      { id: 'bypassed-vol', descriptorId: 'audio-volume', enabled: true, bypassed: true, params: { volume: 1 } },
    ];

    expect(resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: [
        keyframe('disabled', 'effect.disabled-vol.volume', 0, 1),
        keyframe('bypassed', 'effect.bypassed-vol.volume', 0.5, 1),
        keyframe('late', 'effect.enabled-vol.volume', 3, 1),
      ],
      legacyEffects: [
        ...legacyEffects,
        { id: 'enabled-vol', name: 'Volume', type: 'audio-volume', enabled: true, params: { volume: 1 } },
      ],
      audioEffectStack,
      clipDuration: 2,
    })).toEqual([]);
  });
});
