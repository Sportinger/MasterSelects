import type { Keyframe, TimelineClip } from '../../../types';
import {
  applyTimelineMotionStructurePlan,
  planTimelineMotionParentMutation,
} from '../../../services/motionDesign/contracts/timelineStructureAdapter';

export interface MotionParentWorldPreservationContext {
  readonly clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  readonly timelineTime: number;
  readonly compositionId?: string;
}

export type MotionParentWorldPreservationResult =
  | {
      readonly ok: true;
      readonly clips: TimelineClip[];
      readonly clipKeyframes: Map<string, Keyframe[]>;
      readonly clearedClipIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

/**
 * Clears several durable parent edges through the canonical planner/applicator.
 * Intermediate mutations remain local, so callers either publish the complete
 * preserved result or keep their original clips and keyframes unchanged.
 */
export function clearMotionParentsPreservingWorld(
  clips: readonly TimelineClip[],
  childClipIds: readonly string[],
  context: MotionParentWorldPreservationContext,
): MotionParentWorldPreservationResult {
  if (!Number.isFinite(context.timelineTime)) {
    return { ok: false, message: 'Motion parent preservation requires a finite timeline time' };
  }

  let workingClips = [...clips];
  let workingKeyframes = cloneKeyframeMap(context.clipKeyframes);
  const clearedClipIds: string[] = [];
  const uniqueChildIds = [...new Set(childClipIds)].toSorted();
  const compositionId = context.compositionId ?? 'timeline:active';

  for (const childClipId of uniqueChildIds) {
    const child = workingClips.find((clip) => clip.id === childClipId);
    if (!child?.parentClipId) continue;

    const planned = planTimelineMotionParentMutation({
      compositionId,
      clips: workingClips,
      clipKeyframes: workingKeyframes,
      timelineTime: context.timelineTime,
      childClipId,
    });
    if (!planned.ok) {
      return {
        ok: false,
        message: `Could not preserve ${childClipId}: ${planned.failures.map((item) => item.code).join(', ')}`,
      };
    }

    const applied = applyTimelineMotionStructurePlan({
      compositionId,
      clips: workingClips,
      clipKeyframes: workingKeyframes,
      plan: planned.plan,
    });
    if (!applied.ok) {
      return { ok: false, message: `Could not preserve ${childClipId}: ${applied.message}` };
    }

    workingClips = applied.clips;
    workingKeyframes = applied.clipKeyframes;
    clearedClipIds.push(childClipId);
  }

  return {
    ok: true,
    clips: workingClips,
    clipKeyframes: workingKeyframes,
    clearedClipIds,
  };
}

function cloneKeyframeMap(
  source: ReadonlyMap<string, readonly Keyframe[]>,
): Map<string, Keyframe[]> {
  return new Map([...source].map(([clipId, keyframes]) => [
    clipId,
    keyframes.map((keyframe) => structuredClone(keyframe)),
  ]));
}
