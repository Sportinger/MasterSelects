import type { ReactNode } from 'react';

import type { SceneCameraSettings } from '../../../../stores/mediaStore/types';

export type TransformVector3 = { x: number; y: number; z: number };
export type TransformScale = { all?: number; x: number; y: number; z?: number };

export interface TransformTabTransform {
  opacity: number;
  blendMode: string;
  position: TransformVector3;
  scale: TransformScale;
  rotation: TransformVector3;
}

export interface MidiParameterTargetView {
  clipId: string;
  property: string;
  properties?: string[];
  label: string;
  min?: number;
  max?: number;
  currentValue?: number;
}

export type CreateMidiTarget = (
  property: string,
  label: string,
  currentValue: number,
  min?: number,
  max?: number,
  properties?: string[],
) => MidiParameterTargetView;

export type NumberChangeHandler = (value: number) => void;

export interface TransformDragHandlers {
  onDragStart: () => void;
  onDragEnd: () => void;
}

export interface KeyframeToggleFactory {
  (property: string, value: number): ReactNode;
}

export interface CameraValueContext {
  settings: SceneCameraSettings;
  focalLengthMm: number;
  minFocalLengthMm: number;
  maxFocalLengthMm: number;
  resolutionWidth: number;
  resolutionHeight: number;
}
