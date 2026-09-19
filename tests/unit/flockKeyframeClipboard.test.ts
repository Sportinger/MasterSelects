import { describe, expect, it } from 'vitest';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import { createFlockProperty } from '../../src/types/flock';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import {
  createClipboardKeyframes,
  planPastedKeyframes,
} from '../../src/stores/timeline/clipboard/clipboardKeyframeTransfer';

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    trackId: 'video-1',
    name: 'clip',
    file: new File([], 'clip.json'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'flock' },
    transform: {} as TimelineClip['transform'],
    effects: [],
    ...overrides,
  } as TimelineClip;
}

function keyframe(clipId: string, property: string, time: number, value: number): Keyframe {
  return { id: `${property}@${time}`, clipId, property: property as Keyframe['property'], time, value, easing: 'linear' };
}

describe('flock keyframe copy/paste timing', () => {
  const definition = createFlockPresetDefinition('free-swarm');
  const rules = definition.nodes.find((node) => node.operator === 'flock.rules')!;
  const cohesion = createFlockProperty(rules.id, 'cohesion');

  it('copies source-time flock keys as clip-local offsets relative to the earliest key', () => {
    // Second half of a split: inPoint 4, so source 6 is local 2.
    const source = clip({ id: 'b', inPoint: 4, outPoint: 10, duration: 6, flock: definition });
    const { keyframes, skipped } = createClipboardKeyframes([
      keyframe('b', cohesion, 6, 2),
      keyframe('b', 'opacity', 3, 0.5),
    ], [source]);
    expect(skipped).toBe(0);
    expect(keyframes.find((entry) => entry.property === cohesion)?.time).toBeCloseTo(0, 6);
    expect(keyframes.find((entry) => entry.property === 'opacity')?.time).toBeCloseTo(1, 6);
  });

  it('pastes flock keys back into source time on the target clip and keeps clip-local keys local', () => {
    const target = clip({ id: 't', inPoint: 2, outPoint: 12, duration: 10, flock: structuredClone(definition) });
    const plan = planPastedKeyframes({
      clipboardKeyframes: [
        { clipId: 'b', property: cohesion, time: 0, value: 2, easing: 'linear' },
        { clipId: 'b', property: 'opacity', time: 1, value: 0.5, easing: 'linear' },
      ],
      targetClip: target,
      clipLocalTime: 1,
      existing: [],
      createId: (() => { let n = 0; return () => `k${n++}`; })(),
    });
    expect(plan.pasted).toBe(2);
    expect(plan.skipped).toBe(0);
    expect(plan.keyframes.find((entry) => entry.property === cohesion)?.time).toBeCloseTo(3, 6);
    expect(plan.keyframes.find((entry) => entry.property === 'opacity')?.time).toBeCloseTo(2, 6);
  });

  it('skips flock keys whose node or parameter does not exist on the target', () => {
    const otherDefinition = createFlockPresetDefinition('vortex');
    const flockTarget = clip({ id: 'v', flock: otherDefinition });
    const videoTarget = clip({ id: 'video', source: { type: 'video' }, flock: undefined });
    const entries = [{ clipId: 'b', property: cohesion, time: 0, value: 2, easing: 'linear' as const }];
    const createId = () => 'k';
    expect(planPastedKeyframes({ clipboardKeyframes: entries, targetClip: flockTarget, clipLocalTime: 0, existing: [], createId }))
      .toMatchObject({ pasted: 0, skipped: 1 });
    expect(planPastedKeyframes({ clipboardKeyframes: entries, targetClip: videoTarget, clipLocalTime: 0, existing: [], createId }))
      .toMatchObject({ pasted: 0, skipped: 1 });
  });

  it('reports keys that cannot be mapped onto the copied clip window', () => {
    const flat = clip({ id: 'f', inPoint: 0, outPoint: 0, duration: 2, flock: definition });
    const { keyframes, skipped } = createClipboardKeyframes([keyframe('f', cohesion, 5, 1)], [flat], () => 0);
    expect(keyframes).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});
