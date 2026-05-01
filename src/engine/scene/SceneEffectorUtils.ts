import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { getEffectiveScale } from '../../utils/transformScale';
import { resolveSceneClipTransform, type SceneTimelineContext } from './SceneTimelineUtils';
import type { SceneSplatEffectorRuntimeData, SceneVector3 } from './types';

export interface SceneEffectorObjectTransform {
  position: SceneVector3;
  rotation: SceneVector3;
  scale: SceneVector3;
}

export type SceneEffectorResolutionContext = Partial<SceneTimelineContext>;

const EPSILON = 0.0001;
const DISPLACEMENT_GAIN = 0.35;
const SWIRL_GAIN = 0.24;
const NOISE_GAIN = 0.18;
const ROTATION_GAIN = 0.65;

function cloneVec3(value: SceneVector3): SceneVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function add(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(value: SceneVector3, amount: number): SceneVector3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function length(value: SceneVector3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: SceneVector3, fallback: SceneVector3): SceneVector3 {
  const len = length(value);
  if (len < EPSILON) {
    return cloneVec3(fallback);
  }
  return scale(value, 1 / len);
}

function cross(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function orthogonal(value: SceneVector3): SceneVector3 {
  const up = Math.abs(value.z) < 0.95
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 };
  return normalize(cross(value, up), { x: 1, y: 0, z: 0 });
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

export function resolveSceneEffectorsEnabled(value?: boolean): boolean {
  return value !== false;
}

export function resolveSceneEffectorAxis(rotation: SceneSplatEffectorRuntimeData['rotation']): SceneVector3 {
  const rx = -degToRad(rotation.x);
  const ry = degToRad(rotation.y);
  const rz = degToRad(rotation.z);

  let axis: SceneVector3 = { x: 0, y: 0, z: 1 };

  axis = {
    x: axis.x,
    y: axis.y * Math.cos(rx) - axis.z * Math.sin(rx),
    z: axis.y * Math.sin(rx) + axis.z * Math.cos(rx),
  };
  axis = {
    x: axis.x * Math.cos(ry) + axis.z * Math.sin(ry),
    y: axis.y,
    z: -axis.x * Math.sin(ry) + axis.z * Math.cos(ry),
  };
  axis = {
    x: axis.x * Math.cos(rz) - axis.y * Math.sin(rz),
    y: axis.x * Math.sin(rz) + axis.y * Math.cos(rz),
    z: axis.z,
  };

  return normalize(axis, { x: 0, y: 0, z: 1 });
}

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

export function applySceneEffectorsToObjectTransform(
  base: SceneEffectorObjectTransform,
  effectors: SceneSplatEffectorRuntimeData[],
  layerKey: string,
): SceneEffectorObjectTransform {
  const next: SceneEffectorObjectTransform = {
    position: cloneVec3(base.position),
    rotation: cloneVec3(base.rotation),
    scale: cloneVec3(base.scale),
  };

  if (effectors.length === 0) {
    return next;
  }

  const layerSeed = hashString(layerKey) * Math.PI * 2;

  for (const effector of effectors) {
    const radius = Math.max(Math.abs(effector.radius), EPSILON);
    const fromEffector = subtract(next.position, effector.position);
    const distance = length(fromEffector);
    if (distance > radius) {
      continue;
    }

    const influence = Math.pow(
      Math.max(0, 1 - distance / radius),
      Math.max(0.001, effector.falloff),
    );
    const strength = Math.max(0, effector.strength) * 0.01 * influence;
    if (strength <= 0) {
      continue;
    }

    const axis = resolveSceneEffectorAxis(effector.rotation);
    const direction = distance > EPSILON ? scale(fromEffector, 1 / distance) : axis;
    const time = effector.time * Math.max(0.1, effector.speed);

    if (effector.mode === 'repel') {
      next.position = add(next.position, scale(direction, radius * strength * DISPLACEMENT_GAIN));
      continue;
    }

    if (effector.mode === 'attract') {
      next.position = add(next.position, scale(direction, -radius * strength * DISPLACEMENT_GAIN));
      continue;
    }

    if (effector.mode === 'swirl') {
      const tangent = normalize(cross(axis, direction), orthogonal(axis));
      next.position = add(next.position, scale(tangent, radius * strength * SWIRL_GAIN));
      const spin = strength * ROTATION_GAIN * (1 + 0.25 * Math.sin(time + layerSeed));
      next.rotation = add(next.rotation, scale(axis, spin));
      continue;
    }

    const noiseVector = normalize({
      x: Math.sin(time + layerSeed + effector.seed * 0.17 + effector.position.x * 0.31),
      y: Math.cos(time * 1.13 + layerSeed * 1.7 + effector.seed * 0.11 + effector.position.y * 0.29),
      z: Math.sin(time * 0.91 + layerSeed * 2.3 + effector.seed * 0.07 + effector.position.z * 0.37),
    }, axis);
    next.position = add(next.position, scale(noiseVector, radius * strength * NOISE_GAIN));
    next.rotation = add(next.rotation, scale(noiseVector, strength * ROTATION_GAIN * 0.4));
  }

  return next;
}
