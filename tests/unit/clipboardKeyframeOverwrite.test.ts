import { describe, expect, it } from 'vitest';
import { planPastedKeyframes } from '../../src/stores/timeline/clipboard/clipboardKeyframeTransfer';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';
import type { AnimatableProperty } from '../../src/types';

const targetClip = createMockClip({ id: 'audio', source: { type: 'audio' }, duration: 10 });
const key = (time: number, value: number, property: AnimatableProperty = 'effect.volume.volume') => createMockKeyframe({
  clipId: targetClip.id, time, value, property,
});

describe('keyframe paste replacement', () => {
  it('replaces the pasted property interval and preserves keys outside it and other properties', () => {
    const before = key(0, 1);
    const after = key(9, 1);
    const pan = key(4, 0.2, 'effect.pan.pan');
    const existing = [before, key(2, 0.1), key(4, 0.1), key(6, 0.1), after, pan];
    let id = 0;
    const result = planPastedKeyframes({
      targetClip, existing, clipLocalTime: 2,
      clipboardKeyframes: [key(0, 0.8), key(4, 0.9)],
      createId: () => `pasted-${id++}`,
    });
    expect(result.keyframes.filter((entry) => entry.property === 'effect.volume.volume').map(({ time, value }) => [time, value]))
      .toEqual([[0, 1], [2, 0.8], [6, 0.9], [9, 1]]);
    expect(result.keyframes).toContain(pan);
    expect(existing).toHaveLength(6);
    expect(result.pasted).toBe(2);
  });

  it('replaces a coincident key on repeated paste without accumulating duplicates', () => {
    const input = {
      targetClip, clipLocalTime: 0.1 + 0.2,
      clipboardKeyframes: [key(0, 0.75)],
      createId: () => 'pasted',
    };
    const first = planPastedKeyframes({ ...input, existing: [key(0.3, 0.1), key(0.31, 0.5)] });
    const second = planPastedKeyframes({ ...input, existing: first.keyframes });
    expect(second.keyframes).toHaveLength(2);
    expect(second.keyframes[0].value).toBe(0.75);
  });

  it('keeps the last pasted value when multiple keys clamp to a clip boundary', () => {
    let id = 0;
    const result = planPastedKeyframes({
      targetClip, existing: [key(10, 0.1)], clipLocalTime: 10,
      clipboardKeyframes: [key(0, 0.5), key(2, 0.9)],
      createId: () => `pasted-${id++}`,
    });
    expect(result.keyframes).toHaveLength(1);
    expect(result.keyframes[0]).toMatchObject({ time: 10, value: 0.9 });
    expect(result.pasted).toBe(1);
  });

  it('copies curve handles without sharing mutable objects with the clipboard', () => {
    const copied = { ...key(0, 0.5), handleOut: { x: 0.2, y: 0.3 } };
    const result = planPastedKeyframes({
      targetClip, existing: [], clipLocalTime: 1, clipboardKeyframes: [copied], createId: () => 'pasted',
    });
    expect(result.keyframes[0].handleOut).toEqual(copied.handleOut);
    expect(result.keyframes[0].handleOut).not.toBe(copied.handleOut);
  });
});
