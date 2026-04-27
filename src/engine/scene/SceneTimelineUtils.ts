import type { ClipTransform, Keyframe, TimelineClip, TimelineTrack } from '../../types';
import type { SceneCameraConfig } from './types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { composeTransforms } from '../../utils/transformComposition';

export interface SceneTimelineContext {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  clipKeyframes?: Map<string, Keyframe[]>;
  compositionId?: string | null;
  sceneNavClipId?: string | null;
  previewCameraOverride?: SceneCameraConfig | null;
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

export function resolveSceneClipTransform(
  clip: TimelineClip,
  clipLocalTime: number,
  timelineTime: number,
  context: Pick<SceneTimelineContext, 'clips' | 'clipKeyframes'>,
): ClipTransform {
  const keyframes = context.clipKeyframes?.get(clip.id) ?? [];
  const baseTransform = buildBaseTransform(clip);
  const ownTransform = keyframes.length === 0
    ? baseTransform
    : getInterpolatedClipTransform(keyframes, clipLocalTime, baseTransform, {
        rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear',
      });

  if (!clip.parentClipId) {
    return ownTransform;
  }

  const parentClip = context.clips.find((candidate) => candidate.id === clip.parentClipId);
  if (!parentClip) {
    return ownTransform;
  }

  const parentLocalTime = timelineTime - parentClip.startTime;
  const parentTransform = resolveSceneClipTransform(
    parentClip,
    parentLocalTime,
    timelineTime,
    context,
  );
  return composeTransforms(parentTransform, ownTransform);
}
