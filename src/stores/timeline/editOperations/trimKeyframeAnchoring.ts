import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { retimeKeyframesForEdgeTrim } from '../../../utils/keyframeTrimAnchoring';
import { isSourceTimeKeyframe } from '../../../services/flock/time/flockKeyframeTime';
import type { TimelineEditOperation } from './types';

/**
 * Keeps ordinary keyframes timeline-anchored across an edge trim. Opacity fade
 * pairs are special: the first pair follows the clip start, the last pair
 * follows the clip end, and any opacity points between them stay timeline-
 * anchored. Start-only moves and source-only slips are intentionally ignored.
 */
export function buildTrimmedKeyframeState(
  beforeClips: readonly TimelineClip[],
  afterClips: readonly TimelineClip[],
  clipKeyframes: Map<string, Keyframe[]>,
  operationType: TimelineEditOperation['type'],
): { clipKeyframes?: Map<string, Keyframe[]> } {
  const isEdgeTrimOperation = (
    operationType === 'trim-clip' ||
    operationType === 'trim-edge-to-time' ||
    operationType === 'ripple-trim-edge-to-time' ||
    operationType === 'rolling-edit'
  );
  if (!isEdgeTrimOperation) return {};

  const afterById = new Map(afterClips.map((clip) => [clip.id, clip]));
  let nextKeyframes: Map<string, Keyframe[]> | null = null;

  for (const before of beforeClips) {
    const after = afterById.get(before.id);
    const keyframes = clipKeyframes.get(before.id);
    if (!after || !keyframes?.length) continue;

    // Source-time keyframes (flock graph parameters) follow the source window,
    // not the composition: an edge trim changes inPoint, never their times.
    const clipLocalKeyframes = keyframes.filter((keyframe) => !isSourceTimeKeyframe(keyframe));
    if (clipLocalKeyframes.length === 0) continue;
    const retimedClipLocal = retimeKeyframesForEdgeTrim(clipLocalKeyframes, before, after);
    let cursor = 0;
    const retimed = keyframes.map((keyframe) => (
      isSourceTimeKeyframe(keyframe) ? keyframe : retimedClipLocal[cursor++]
    ));
    if (retimed.every((keyframe, index) => keyframe.time === keyframes[index].time)) continue;
    nextKeyframes ??= new Map(clipKeyframes);
    nextKeyframes.set(before.id, retimed);
  }

  return nextKeyframes ? { clipKeyframes: nextKeyframes } : {};
}
