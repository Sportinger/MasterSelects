import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { ClipTransform, Keyframe, TimelineClip } from '../../types';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { composeTransforms } from '../../utils/transformComposition';
import {
  evaluateTransitionMappedAnimation,
  type TransitionMappedAnimation,
} from '../compositionRender/transitionMappedAnimation';

export type ParentTransformEvaluationFailureReason =
  | 'invalid-time'
  | 'duplicate-clip'
  | 'missing-target'
  | 'missing-parent'
  | 'cycle'
  | 'invalid-mapped-animation';

export type ParentTransformEvaluationResult =
  | {
      ok: true;
      transform: ClipTransform;
      ownTransform: ClipTransform;
      keyframes: Keyframe[];
      mappedAnimation: TransitionMappedAnimation | undefined;
    }
  | {
      ok: false;
      reason: ParentTransformEvaluationFailureReason;
      clipId: string;
      parentClipId?: string;
    };

export interface ParentTransformEvaluationInput {
  /** Target clip whose world transform should be evaluated. */
  clip: TimelineClip;
  /** Every clip in the target's same-composition parent namespace. */
  clips: readonly TimelineClip[];
  /** Target-local animation time. */
  clipLocalTime: number;
  /** Exact same-composition time used for every ancestor in the chain. */
  parentTimelineTime: number;
  getKeyframes: (clip: TimelineClip) => readonly Keyframe[] | undefined;
}

function buildBaseTransform(clip: TimelineClip): ClipTransform {
  return {
    opacity: clip.transform?.opacity ?? DEFAULT_TRANSFORM.opacity,
    blendMode: clip.transform?.blendMode ?? DEFAULT_TRANSFORM.blendMode,
    position: {
      x: clip.transform?.position?.x ?? DEFAULT_TRANSFORM.position.x,
      y: clip.transform?.position?.y ?? DEFAULT_TRANSFORM.position.y,
      z: clip.transform?.position?.z ?? DEFAULT_TRANSFORM.position.z,
    },
    scale: {
      ...(clip.transform?.scale?.all !== undefined ? { all: clip.transform.scale.all } : {}),
      x: clip.transform?.scale?.x ?? DEFAULT_TRANSFORM.scale.x,
      y: clip.transform?.scale?.y ?? DEFAULT_TRANSFORM.scale.y,
      ...(clip.transform?.scale?.z !== undefined ? { z: clip.transform.scale.z } : {}),
    },
    rotation: {
      x: clip.transform?.rotation?.x ?? DEFAULT_TRANSFORM.rotation.x,
      y: clip.transform?.rotation?.y ?? DEFAULT_TRANSFORM.rotation.y,
      z: clip.transform?.rotation?.z ?? DEFAULT_TRANSFORM.rotation.z,
    },
  };
}

/**
 * Pure, exact-frame parent evaluation shared by preview and export builders.
 * The target may use transition-mapped animation; that animation remains its
 * local transform and is composed with every ancestor instead of replacing
 * the parent chain.
 */
export function evaluateParentedClipTransform(
  input: ParentTransformEvaluationInput,
): ParentTransformEvaluationResult {
  if (!Number.isFinite(input.clipLocalTime) || !Number.isFinite(input.parentTimelineTime)) {
    return { ok: false, reason: 'invalid-time', clipId: input.clip.id };
  }

  const clipsById = new Map<string, TimelineClip>();
  for (const clip of input.clips) {
    if (clipsById.has(clip.id)) {
      return { ok: false, reason: 'duplicate-clip', clipId: clip.id };
    }
    clipsById.set(clip.id, clip);
  }
  const targetClip = clipsById.get(input.clip.id);
  if (!targetClip) {
    return { ok: false, reason: 'missing-target', clipId: input.clip.id };
  }

  const visiting = new Set<string>();
  const resolved = new Map<string, ClipTransform>();
  let targetOwnTransform: ClipTransform | undefined;
  let targetKeyframes: Keyframe[] = [];
  let targetMappedAnimation: TransitionMappedAnimation | undefined;

  const evaluateClip = (
    clip: TimelineClip,
    localTime: number,
  ): ClipTransform | ParentTransformEvaluationResult => {
    const cached = resolved.get(clip.id);
    if (cached) return cached;
    if (visiting.has(clip.id)) {
      return { ok: false, reason: 'cycle', clipId: clip.id };
    }

    visiting.add(clip.id);
    const keyframes = [...(input.getKeyframes(clip) ?? [])];
    const mappedAnimation = clip.transitionSourceMap?.version === 2
      ? evaluateTransitionMappedAnimation(clip, keyframes, localTime)
      : undefined;
    if (mappedAnimation === null) {
      visiting.delete(clip.id);
      return { ok: false, reason: 'invalid-mapped-animation', clipId: clip.id };
    }

    const baseTransform = buildBaseTransform(clip);
    const ownTransform = mappedAnimation?.transform ?? (keyframes.length > 0
      ? getInterpolatedClipTransform(keyframes, localTime, baseTransform, {
          rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear',
        })
      : baseTransform);

    if (clip.id === input.clip.id) {
      targetOwnTransform = ownTransform;
      targetKeyframes = keyframes;
      targetMappedAnimation = mappedAnimation;
    }

    let worldTransform = ownTransform;
    if (clip.parentClipId) {
      const parent = clipsById.get(clip.parentClipId);
      if (!parent) {
        visiting.delete(clip.id);
        return {
          ok: false,
          reason: 'missing-parent',
          clipId: clip.id,
          parentClipId: clip.parentClipId,
        };
      }

      const parentTransform = evaluateClip(
        parent,
        input.parentTimelineTime - parent.startTime,
      );
      if ('ok' in parentTransform) {
        visiting.delete(clip.id);
        return parentTransform;
      }
      worldTransform = composeTransforms(parentTransform, ownTransform);
    }

    visiting.delete(clip.id);
    resolved.set(clip.id, worldTransform);
    return worldTransform;
  };

  const transform = evaluateClip(targetClip, input.clipLocalTime);
  if ('ok' in transform) return transform;

  return {
    ok: true,
    transform,
    ownTransform: targetOwnTransform!,
    keyframes: targetKeyframes,
    mappedAnimation: targetMappedAnimation,
  };
}
