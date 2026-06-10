import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../../../stores/mediaStore/types';
import {
  MAX_CAMERA_FOV_DEGREES,
  MIN_CAMERA_FOV_DEGREES,
  fovToFullFrameFocalLengthMm,
} from '../../../../utils/cameraLens';
import type { CameraValueContext, TransformTabTransform } from './transformTabTypes';

export interface PositionValueContext {
  usesScenePositionUnits: boolean;
  posXValue: number;
  posYValue: number;
  posZValue: number;
  positionDecimals: number;
  positionSensitivity: number;
  cameraPositionX: number;
  cameraPositionY: number;
  cameraPositionZ: number;
}

export interface ScaleValueContext {
  scaleAll: number;
  scaleAllPct: number;
  scaleXPct: number;
  scaleYPct: number;
  scaleZPct: number;
}

export function resolveCameraValues(
  settings: SceneCameraSettings,
): CameraValueContext {
  return {
    settings,
    focalLengthMm: fovToFullFrameFocalLengthMm(settings.fov),
    minFocalLengthMm: fovToFullFrameFocalLengthMm(MAX_CAMERA_FOV_DEGREES),
    maxFocalLengthMm: fovToFullFrameFocalLengthMm(MIN_CAMERA_FOV_DEGREES),
    resolutionWidth: settings.resolutionWidth ?? DEFAULT_SCENE_CAMERA_SETTINGS.resolutionWidth ?? 1920,
    resolutionHeight: settings.resolutionHeight ?? DEFAULT_SCENE_CAMERA_SETTINGS.resolutionHeight ?? 1080,
  };
}

export function resolvePositionValues({
  transform,
  compWidth,
  compHeight,
  isEffectively3D,
  usesCameraControls,
}: {
  transform: TransformTabTransform;
  compWidth: number;
  compHeight: number;
  isEffectively3D: boolean;
  usesCameraControls: boolean;
}): PositionValueContext {
  const usesScenePositionUnits = isEffectively3D && !usesCameraControls;
  const posXPx = transform.position.x * (compWidth / 2);
  const posYPx = transform.position.y * (compHeight / 2);
  const posZPx = transform.position.z * (compWidth / 2);

  return {
    usesScenePositionUnits,
    posXValue: usesScenePositionUnits ? transform.position.x : posXPx,
    posYValue: usesScenePositionUnits ? transform.position.y : posYPx,
    posZValue: usesScenePositionUnits ? transform.position.z : posZPx,
    positionDecimals: usesScenePositionUnits || usesCameraControls ? 3 : 1,
    positionSensitivity: usesScenePositionUnits || usesCameraControls ? 0.02 : 0.5,
    cameraPositionX: transform.position.x,
    cameraPositionY: transform.position.y,
    cameraPositionZ: transform.position.z,
  };
}

export function resolveScaleValues(transform: TransformTabTransform): ScaleValueContext {
  const scaleAll = transform.scale.all ?? 1;

  return {
    scaleAll,
    scaleAllPct: scaleAll * 100,
    scaleXPct: transform.scale.x * 100,
    scaleYPct: transform.scale.y * 100,
    scaleZPct: (transform.scale.z ?? 1) * 100,
  };
}
