import type { ClipTransform, KeyframeActions, SliceCreator } from '../types';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../mediaStore/types';
import { DEFAULT_TRANSFORM } from '../constants';
import { DEFAULT_LIGHT_CLIP_SETTINGS, mergeLightClipSettings } from '../../../types/light';
import {
  getInterpolatedClipCameraSettings,
  getInterpolatedClipLightSettings,
  getInterpolatedClipTransform,
} from '../../../utils/keyframeInterpolation';
import { calculateSourceTime, getSpeedAtTime } from '../../../utils/speedIntegration';
import { composeTransforms } from '../../../utils/transformComposition';
import { findClipById } from './keyframeClipLookup';

type KeyframeTransformInterpolationActions = Pick<
  KeyframeActions,
  | 'getInterpolatedTransform'
  | 'getInterpolatedCameraSettings'
  | 'getInterpolatedLightSettings'
  | 'getInterpolatedSpeed'
  | 'getSourceTimeForClip'
>;

export const createKeyframeTransformInterpolationActions: SliceCreator<KeyframeTransformInterpolationActions> = (_set, get) => ({
  getInterpolatedTransform: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes, playheadPosition } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      return { ...DEFAULT_TRANSFORM };
    }

    const baseTransform: ClipTransform = {
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

    const keyframes = clipKeyframes.get(clipId) || [];
    const ownTransform = keyframes.length === 0
      ? baseTransform
      : getInterpolatedClipTransform(keyframes, clipLocalTime, baseTransform, {
          rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear',
        });

    if (clip.parentClipId) {
      const parentClip = clips.find(c => c.id === clip.parentClipId);
      if (parentClip) {
        const parentLocalTime = playheadPosition - parentClip.startTime;
        const parentTransform = get().getInterpolatedTransform(clip.parentClipId, parentLocalTime);
        return composeTransforms(parentTransform, ownTransform);
      }
    }

    return ownTransform;
  },

  getInterpolatedCameraSettings: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    if (clip?.source?.type !== 'camera') {
      return { ...DEFAULT_SCENE_CAMERA_SETTINGS };
    }

    const baseSettings: SceneCameraSettings = {
      ...DEFAULT_SCENE_CAMERA_SETTINGS,
      ...clip.source.cameraSettings,
    };
    const keyframes = clipKeyframes.get(clipId) || [];
    return getInterpolatedClipCameraSettings(keyframes, clipLocalTime, baseSettings);
  },

  getInterpolatedLightSettings: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    if (clip?.source?.type !== 'light') {
      return { ...DEFAULT_LIGHT_CLIP_SETTINGS };
    }

    const baseSettings = mergeLightClipSettings(clip.source.lightSettings);
    const keyframes = clipKeyframes.get(clipId) || [];
    return getInterpolatedClipLightSettings(keyframes, clipLocalTime, baseSettings);
  },

  getInterpolatedSpeed: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return 1;

    const keyframes = clipKeyframes.get(clipId) || [];
    const defaultSpeed = clip.speed ?? 1;

    return getSpeedAtTime(keyframes, clipLocalTime, defaultSpeed);
  },

  getSourceTimeForClip: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return clipLocalTime;

    const keyframes = clipKeyframes.get(clipId) || [];
    const defaultSpeed = clip.speed ?? 1;
    const speedKeyframes = keyframes.filter(k => k.property === 'speed');
    if (speedKeyframes.length === 0 && defaultSpeed === 1) {
      return clipLocalTime;
    }

    return calculateSourceTime(keyframes, clipLocalTime, defaultSpeed);
  },
});
