import { describe, expect, it, vi } from 'vitest';
import {
  addParticleDisintegrateOutroPreset,
  buildParticleDisintegrateOutroKeyframes,
} from '../../src/effects/presets/particleDisintegrateOutro';

describe('particle disintegrate outro preset', () => {
  it('builds progress keyframes at the clip end', () => {
    expect(buildParticleDisintegrateOutroKeyframes('fx-particle', 5)).toEqual([
      {
        property: 'effect.fx-particle.progress',
        value: 0,
        time: 4,
        easing: 'linear',
      },
      {
        property: 'effect.fx-particle.progress',
        value: 1,
        time: 5,
        easing: 'ease-in-out',
      },
    ]);
  });

  it('clamps the preset duration for short clips', () => {
    expect(buildParticleDisintegrateOutroKeyframes('fx-particle', 0.5, 1)).toEqual([
      expect.objectContaining({ value: 0, time: 0 }),
      expect.objectContaining({ value: 1, time: 0.5 }),
    ]);
  });

  it('adds the effect and creates the preset keyframes', () => {
    const addClipEffect = vi.fn(() => 'fx-created');
    const addKeyframe = vi.fn();

    const effectId = addParticleDisintegrateOutroPreset({
      clipId: 'clip-1',
      clipDuration: 3,
      addClipEffect,
      addKeyframe,
    });

    expect(effectId).toBe('fx-created');
    expect(addClipEffect).toHaveBeenCalledWith('clip-1', 'pixel-particle-disintegrate');
    expect(addKeyframe).toHaveBeenCalledTimes(2);
    expect(addKeyframe).toHaveBeenNthCalledWith(
      1,
      'clip-1',
      'effect.fx-created.progress',
      0,
      2,
      'linear',
    );
    expect(addKeyframe).toHaveBeenNthCalledWith(
      2,
      'clip-1',
      'effect.fx-created.progress',
      1,
      3,
      'ease-in-out',
    );
  });

  it('does not keyframe if the effect could not be created', () => {
    const addClipEffect = vi.fn(() => null);
    const addKeyframe = vi.fn();

    expect(addParticleDisintegrateOutroPreset({
      clipId: 'clip-1',
      clipDuration: 3,
      addClipEffect,
      addKeyframe,
    })).toBeNull();
    expect(addKeyframe).not.toHaveBeenCalled();
  });
});
