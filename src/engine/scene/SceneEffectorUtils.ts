import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { getEffectiveScale } from '../../utils/transformScale';
import { resolveSceneClipTransform, type SceneTimelineContext } from './SceneTimelineUtils';
import type { SceneSplatEffectorRuntimeData } from './types';


export { resolveSceneEffectorsEnabled, resolveSceneEffectorAxis, applySceneEffectorsToObjectTransform } from './SceneEffectorEvaluation';
export type { SceneEffectorObjectTransform } from './SceneEffectorEvaluation';
export type SceneEffectorResolutionContext = Partial<SceneTimelineContext>;

export function collectActiveSceneSplatEffectors(
  width: number,
  height: number,
  timelineTime: number = useTimelineStore.getState().playheadPosition,
  context?: SceneEffectorResolutionContext,
): SceneSplatEffectorRuntimeData[] {
  const timelineStore = useTimelineStore.getState();
  const clips = context?.clips ?? timelineStore.clips;
  const tracks = context?.tracks ?? timelineStore.tracks;
  const clipKeyframes = context?.clipKeyframes ?? timelineStore.clipKeyframes;
  const worldHeight = 2.0;
  const halfWorldW = (worldHeight * (width / Math.max(height, 1))) / 2;
  const halfWorldH = worldHeight / 2;
  const visibleTrackIds = new Set(
    tracks
      .filter((track) => track.type === 'video' && track.visible !== false)
      .map((track) => track.id),
  );

  return clips
    .filter((clip) => {
      if (clip.source?.type !== 'splat-effector') return false;
      if (!visibleTrackIds.has(clip.trackId)) return false;
      return timelineTime >= clip.startTime && timelineTime < clip.startTime + clip.duration;
    })
    .map((clip) => {
      const clipLocalTime = timelineTime - clip.startTime;
      const transform = resolveSceneClipTransform(clip, clipLocalTime, timelineTime, {
        clips,
        clipKeyframes,
      });
      const settings = clip.source?.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS;
      const effectiveScale = getEffectiveScale(transform.scale);
      const scaleZ = effectiveScale.z ?? 1;
      const scaleX = Math.abs(effectiveScale.x);
      const scaleY = Math.abs(effectiveScale.y);
      const scaleZAbs = Math.abs(scaleZ);

      return {
        clipId: clip.id,
        position: {
          x: transform.position.x * halfWorldW,
          y: -transform.position.y * halfWorldH,
          z: transform.position.z,
        },
        rotation: {
          x: transform.rotation.x,
          y: transform.rotation.y,
          z: transform.rotation.z,
        },
        scale: {
          x: scaleX,
          y: scaleY,
          z: scaleZAbs,
        },
        radius: Math.max(scaleX, scaleY, scaleZAbs, 0.0001),
        mode: settings.mode,
        strength: settings.strength,
        falloff: settings.falloff,
        speed: settings.speed,
        seed: settings.seed,
        time: clipLocalTime,
      };
    });
}
