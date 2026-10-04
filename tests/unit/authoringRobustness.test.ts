import { afterEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { executeAITool } from '../../src/services/aiTools';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { interpolateKeyframes } from '../../src/utils/keyframeInterpolation';
import { isHoldEasing } from '../../src/utils/easing';
import { parameterSourceSplitPatch, trimmedParameterSourceClips } from '../../src/services/parameterSources/parameterSourceLifecycle';
import { parseSkeletonActions, serializeSkeletonActions, shiftSkeletonActions } from '../../src/services/rig/skeletonActions';
import { createDefaultSkeletonShape, figureMirror, mirroredAngle, skeletonFromParams, unfacingX, facingX } from '../../src/services/rig/skeletonRig';
import { stickFigure } from '../../src/effects/generate/stickFigure';
import { STICK_FIGURE_PARAMS } from '../../src/effects/generate/stickFigure/params';
import type { Effect } from '../../src/types/effects';
import type { TimelineClip } from '../../src/types/timeline';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));

const figureEffect = (actions: string): Effect => ({ id: 'fx', name: 'Stick Figure', type: 'stick-figure', enabled: true,
  params: { actions } } as Effect);

describe('hold keyframes', () => {
  it('recognizes hold easings and keeps the value until the next key', () => {
    for (const name of ['hold', 'Step', ' constant ']) expect(isHoldEasing(name)).toBe(true);
    expect(isHoldEasing('ease-in')).toBe(false);
    const clip = createMockClip({ id: 'c', trackId: 't', duration: 4 });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
    useTimelineStore.getState().addKeyframe('c', 'opacity', 0.2, 1, 'hold');
    useTimelineStore.getState().addKeyframe('c', 'opacity', 0.9, 3, 'linear');
    const keys = useTimelineStore.getState().clipKeyframes.get('c')!;
    expect(keys[0]).toMatchObject({ hold: true, easing: 'linear' });
    expect(interpolateKeyframes(keys, 'opacity', 2.9, 1)).toBeCloseTo(0.2);
    expect(interpolateKeyframes(keys, 'opacity', 3, 1)).toBeCloseTo(0.9);
    // Re-keying with a normal easing clears the hold.
    useTimelineStore.getState().addKeyframe('c', 'opacity', 0.3, 1, 'ease-out');
    expect(useTimelineStore.getState().clipKeyframes.get('c')![0].hold).toBeUndefined();
  });
});

describe('effect parameter validation', () => {
  it('rejects misspelled parameters instead of storing them silently', async () => {
    const clip = createMockClip({ id: 'c', trackId: 't', duration: 4, effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
    const added = await executeAITool('addEffect', { clipId: 'c', effectType: 'brightness', params: {} }, 'internal');
    const effectId = (added.data as { effectId: string }).effectId;
    const typo = await executeAITool('updateEffect', { clipId: 'c', effectId, params: { amout: 0.3 } }, 'internal');
    expect(typo.success).toBe(false);
    expect(typo.error).toMatch(/Unknown parameter.*amout.*Valid:.*amount/);
    const ok = await executeAITool('updateEffect', { clipId: 'c', effectId, params: { amount: 0.3 } }, 'internal');
    expect(ok.success).toBe(true);
  });
});

describe('action lanes follow split and trim', () => {
  const lane = serializeSkeletonActions([
    { id: 'walk', action: 'walk', start: 0, duration: 2 },
    { id: 'punch', action: 'punch', start: 2.5, duration: 0.55 },
  ]);

  it('shifts the right part of a split so actions keep their timeline position', () => {
    const clip = createMockClip({ id: 'c', startTime: 10, duration: 5, effects: [figureEffect(lane)] }) as TimelineClip;
    const patch = parameterSourceSplitPatch(clip, 2);
    const actions = parseSkeletonActions(patch.effects![0].params.actions);
    expect(actions.map(action => [action.id, action.start])).toEqual([['walk', -2], ['punch', 0.5]]);
    expect(parameterSourceSplitPatch(createMockClip({ effects: [] }) as TimelineClip, 2)).toEqual({});
    expect(shiftSkeletonActions('[]', 3)).toBe('[]');
  });

  it('shifts on a left trim but not on a move', () => {
    const before = createMockClip({ id: 'c', startTime: 10, duration: 5, effects: [figureEffect(lane)] }) as TimelineClip;
    const trimmed = { ...before, startTime: 11, duration: 4 };
    const [result] = trimmedParameterSourceClips([before], [trimmed]);
    expect(parseSkeletonActions(result.effects[0].params.actions)[1].start).toBeCloseTo(1.5);
    const moved = { ...before, startTime: 12 };
    expect(trimmedParameterSourceClips([before], [moved])[0]).toBe(moved);
  });
});

describe('stick figure turn and scale', () => {
  it('turns around through a squash and mirrors bone angles', () => {
    expect(figureMirror({})).toBe(1);
    expect(figureMirror({ facing: 'left', turn: 0.5 })).toBe(-0.5);
    expect(figureMirror({ turn: 7 })).toBe(1);
    expect(unfacingX(facingX(70, 150, -0.5), 150, -0.5)).toBeCloseTo(70);
    expect(mirroredAngle(30, -1)).toBeCloseTo(150);
    expect(mirroredAngle(90, 0.2)).toBeCloseTo(90);
    const params = Object.fromEntries(Object.entries(STICK_FIGURE_PARAMS).map(([key, def]) => [key, def.default])) as Record<string, number | string>;
    const full = stickFigure.packUniforms({ ...params, rootX: 0 }, 1080, 1080)!;
    const half = stickFigure.packUniforms({ ...params, rootX: 0, turn: 0.5 }, 1080, 1080)!;
    // The hand of the half-turned figure sits half as far from the pelvis.
    expect(half[12 + 5 * 2] - half[12]).toBeCloseTo((full[12 + 5 * 2] - full[12]) / 2);
  });

  it('scales every bone and the thickness together', () => {
    const base = createDefaultSkeletonShape();
    const small = skeletonFromParams({ scale: 0.5 });
    expect(small.thigh).toBeCloseTo(base.thigh / 2);
    expect(small.thickness).toBeCloseTo(base.thickness / 2);
    expect(skeletonFromParams({ scale: 0.5, thigh: 100 }).thigh).toBeCloseTo(50);
    expect(small.hipL).toBe(base.hipL);
  });
});
