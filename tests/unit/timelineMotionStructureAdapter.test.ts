import { describe, expect, it } from 'vitest';
import { createMd1GoldenFixture } from '../../src/services/motionDesign/evidence/md1GoldenFixture';
import {
  applyTimelineMotionCreateNullAndParentSelectedPlan,
  applyTimelineMotionStructurePlan,
  planTimelineMotionCreateNullAndParentSelected,
  planTimelineMotionParentMutation,
} from '../../src/services/motionDesign/contracts/timelineStructureAdapter';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';

function createClips(): { parent: TimelineClip; child: TimelineClip } {
  const fixture = createMd1GoldenFixture();
  const parent = structuredClone(fixture.clips[0]);
  const child = structuredClone(fixture.clips[1]);
  parent.id = 'adapter-parent';
  parent.startTime = 0;
  parent.duration = 4;
  child.id = 'adapter-child';
  child.startTime = 0;
  child.duration = 4;
  delete parent.parentClipId;
  delete child.parentClipId;
  return { parent, child };
}

describe('timeline Motion structure adapter', () => {
  it('creates one null and parents the full selection in one planned transaction', () => {
    const { parent, child } = createClips();
    const nullClip = {
      ...structuredClone(child),
      id: 'adapter-null',
      name: 'Null',
      source: { type: 'motion-null', naturalDuration: 4 },
    } as unknown as TimelineClip;
    delete nullClip.parentClipId;
    const clips = [parent, child];
    const before = structuredClone(clips);
    const result = planTimelineMotionCreateNullAndParentSelected({
      compositionId: 'adapter-comp',
      clips,
      clipKeyframes: new Map(),
      timelineTime: 2,
      nullClip,
      selectedClipIds: [child.id, parent.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.history).toEqual({
      mode: 'single-entry',
      label: 'Create Null and Parent Selection',
      atomic: true,
    });

    const applied = applyTimelineMotionCreateNullAndParentSelectedPlan({
      compositionId: 'adapter-comp',
      clips,
      clipKeyframes: new Map(),
      timelineTime: 2,
      nullClip,
      selectedClipIds: [child.id, parent.id],
      plan: result.plan,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.clips).toHaveLength(3);
    expect(applied.clips.find((clip) => clip.id === nullClip.id)?.parentClipId).toBeUndefined();
    expect(applied.clips.filter((clip) => clip.id !== nullClip.id)
      .every((clip) => clip.parentClipId === nullClip.id)).toBe(true);
    expect(clips).toEqual(before);
  });

  it('recovers a dangling parent edge through the normal clear-parent transaction', () => {
    const { parent, child } = createClips();
    const danglingChild = { ...child, parentClipId: 'missing-parent' };
    const result = planTimelineMotionParentMutation({
      compositionId: 'adapter-comp',
      clips: [parent, danglingChild],
      clipKeyframes: new Map(),
      timelineTime: 2,
      childClipId: child.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('MD6_PARENT_EXTERNAL_EDGE_CLEARED');

    const applied = applyTimelineMotionStructurePlan({
      compositionId: 'adapter-comp',
      clips: [parent, danglingChild],
      clipKeyframes: new Map(),
      plan: result.plan,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.clips.find((clip) => clip.id === child.id)?.parentClipId).toBeUndefined();
  });

  it('rejects a plan when transform state changes without changing the parent graph revision', () => {
    const { parent, child } = createClips();
    const clips = [parent, child];
    const result = planTimelineMotionParentMutation({
      compositionId: 'adapter-comp',
      clips,
      clipKeyframes: new Map(),
      timelineTime: 2,
      childClipId: child.id,
      parentClipId: parent.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const changedParent: TimelineClip = {
      ...parent,
      transform: {
        ...parent.transform,
        position: {
          ...parent.transform.position,
          x: parent.transform.position.x + 25,
        },
      },
    };
    const applied = applyTimelineMotionStructurePlan({
      compositionId: 'adapter-comp',
      clips: [changedParent, child],
      clipKeyframes: new Map(),
      plan: result.plan,
    });

    expect(applied).toEqual({
      ok: false,
      message: 'Timeline parent plan transform state is stale',
    });
  });

  it('rejects a plan when operation-time keyframes change without changing the parent graph revision', () => {
    const { parent, child } = createClips();
    const initialKeyframes: Keyframe[] = [{
      id: 'child-position',
      clipId: child.id,
      property: 'position.x',
      time: 2,
      value: 10,
      easing: 'linear',
    }];
    const result = planTimelineMotionParentMutation({
      compositionId: 'adapter-comp',
      clips: [parent, child],
      clipKeyframes: new Map([[child.id, initialKeyframes]]),
      timelineTime: 2,
      childClipId: child.id,
      parentClipId: parent.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const applied = applyTimelineMotionStructurePlan({
      compositionId: 'adapter-comp',
      clips: [parent, child],
      clipKeyframes: new Map([[child.id, [{ ...initialKeyframes[0], value: 35 }]]]),
      plan: result.plan,
    });

    expect(applied).toEqual({
      ok: false,
      message: 'Timeline parent plan transform state is stale',
    });
  });

  it('moves a tolerated nearby keyframe to the exact operation time', () => {
    const { parent, child } = createClips();
    const nearbyTime = 1.995;
    const keyframes: Keyframe[] = [{
      id: 'child-position-nearby',
      clipId: child.id,
      property: 'position.x',
      time: nearbyTime,
      value: 10,
      easing: 'linear',
    }];
    const result = planTimelineMotionParentMutation({
      compositionId: 'adapter-comp',
      clips: [parent, child],
      clipKeyframes: new Map([[child.id, keyframes]]),
      timelineTime: 2,
      childClipId: child.id,
      parentClipId: parent.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const applied = applyTimelineMotionStructurePlan({
      compositionId: 'adapter-comp',
      clips: [parent, child],
      clipKeyframes: new Map([[child.id, keyframes]]),
      plan: result.plan,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const positionKeyframe = applied.clipKeyframes.get(child.id)
      ?.find((keyframe) => keyframe.id === 'child-position-nearby');
    expect(positionKeyframe?.time).toBe(2);
    expect(applied.clipKeyframes.get(child.id)
      ?.filter((keyframe) => keyframe.property === 'position.x' && keyframe.time === 2))
      .toHaveLength(1);
  });
});
