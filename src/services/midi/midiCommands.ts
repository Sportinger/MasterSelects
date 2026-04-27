import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useEngineStore } from '../../stores/engineStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { engine } from '../../engine/WebGPUEngine';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../stores/timeline/constants';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../engine/gaussian/types';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import {
  CAMERA_POSE_TRANSFORM_PROPERTIES,
  buildCameraTransformPatchFromUpdates,
  getCameraLookRotationAxis,
  resolveCameraLookAtFixedEyeUpdates,
} from '../../engine/scene/CameraClipControlUtils';
import type {
  MarkerMIDIBinding,
  MarkerMIDIAction,
  MIDIParameterBinding,
  SlotMIDIBinding,
  MIDITransportAction,
} from '../../types/midi';
import type { AnimatableProperty, Text3DProperties, TimelineClip } from '../../types';

type ClipSource = NonNullable<TimelineClip['source']>;

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function seekTimeline(time: number, shouldPlayAfterSeek: boolean): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const clampedTime = Math.max(0, Math.min(time, timelineStore.duration));
  const wasPlaying = timelineStore.isPlaying;
  const previousSpeed = timelineStore.playbackSpeed;

  if (wasPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlayheadPosition(clampedTime);
  await waitForAnimationFrame();

  if (shouldPlayAfterSeek || wasPlaying) {
    await timelineStore.play();
    timelineStore.setPlaybackSpeed(previousSpeed);
  }
}

export async function jumpToMarkerTime(time: number): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  await seekTimeline(time, false);
  timelineStore.setDraggingPlayhead(false);
}

export async function jumpToMarkerAndStopTime(time: number): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const clampedTime = Math.max(0, Math.min(time, timelineStore.duration));

  if (timelineStore.isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlayheadPosition(clampedTime);
}

export async function playFromMarkerTime(time: number): Promise<void> {
  await seekTimeline(time, true);
}

export async function togglePlaybackFromMIDI(): Promise<void> {
  const timelineStore = useTimelineStore.getState();

  if (timelineStore.isPlaying) {
    timelineStore.pause();
    return;
  }

  await timelineStore.play();
}

export async function stopPlaybackFromMIDI(): Promise<void> {
  const timelineStore = useTimelineStore.getState();

  if (timelineStore.isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlayheadPosition(0);
}

export async function triggerMIDITransportAction(action: MIDITransportAction): Promise<void> {
  if (action === 'stop') {
    await stopPlaybackFromMIDI();
    return;
  }

  await togglePlaybackFromMIDI();
}

export async function triggerMarkerMIDIAction(
  action: MarkerMIDIAction,
  time: number
): Promise<void> {
  if (action === 'playFromMarker') {
    await playFromMarkerTime(time);
    return;
  }

  if (action === 'jumpToMarkerAndStop') {
    await jumpToMarkerAndStopTime(time);
    return;
  }

  await jumpToMarkerTime(time);
}

export async function triggerMarkerMIDIBinding(binding: MarkerMIDIBinding): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const marker = timelineStore.markers.find((candidate) => candidate.midiBindings?.some((candidateBinding) => (
    candidateBinding.action === binding.action
    && candidateBinding.channel === binding.channel
    && candidateBinding.note === binding.note
  )));

  if (!marker) {
    return;
  }

  await triggerMarkerMIDIAction(binding.action, marker.time);
}

export async function triggerSlotMIDIAction(slotIndex: number): Promise<void> {
  const mediaStore = useMediaStore.getState();
  const slotEntry = Object.entries(mediaStore.slotAssignments ?? {})
    .find(([, assignedSlotIndex]) => assignedSlotIndex === slotIndex);
  const compositionId = slotEntry?.[0];

  if (!compositionId) {
    return;
  }

  const layerIndex = Math.floor(slotIndex / 12);
  mediaStore.triggerLiveSlot(compositionId, layerIndex);
}

export async function triggerSlotMIDIBinding(binding: SlotMIDIBinding): Promise<void> {
  await triggerSlotMIDIAction(binding.slotIndex);
}

function resolveParameterRange(binding: MIDIParameterBinding): { min: number; max: number } {
  if (
    typeof binding.min === 'number' &&
    typeof binding.max === 'number' &&
    Number.isFinite(binding.min) &&
    Number.isFinite(binding.max) &&
    binding.max > binding.min
  ) {
    return { min: binding.min, max: binding.max };
  }

  const center = typeof binding.currentValue === 'number' && Number.isFinite(binding.currentValue)
    ? binding.currentValue
    : 0;
  const range = Math.max(Math.abs(center), 1) * 4;
  return {
    min: center - range / 2,
    max: center + range / 2,
  };
}

function mapMIDIValueToParameter(binding: MIDIParameterBinding, midiValue: number): number {
  const safeMIDIValue = Math.max(0, Math.min(127, Number.isFinite(midiValue) ? midiValue : 0));
  const { min, max } = resolveParameterRange(binding);
  const normalizedValue = binding.invert ? 127 - safeMIDIValue : safeMIDIValue;
  return min + (normalizedValue / 127) * (max - min);
}

function roundIntegerParameter(property: string, value: number): number {
  if (
    property.endsWith('.maxSplats') ||
    property.endsWith('.sortFrequency') ||
    property.endsWith('.seed') ||
    property.endsWith('.curveSegments') ||
    property.endsWith('.bevelSegments') ||
    property.endsWith('.featherQuality')
  ) {
    return Math.round(value);
  }

  return value;
}

function updateClipSource(
  clipId: string,
  updater: (source: ClipSource) => ClipSource | null
): boolean {
  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (!clip?.source) {
    return false;
  }

  const nextSource = updater(clip.source as ClipSource);
  if (!nextSource) {
    return false;
  }

  timelineStore.updateClip(clipId, { source: nextSource });
  timelineStore.invalidateCache();
  return true;
}

function applyCameraParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('camera.')) {
    return false;
  }

  const key = property.slice('camera.'.length);
  if (key !== 'fov' && key !== 'near' && key !== 'far') {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'camera') {
      return null;
    }

    return {
      ...source,
      cameraSettings: {
        ...DEFAULT_SCENE_CAMERA_SETTINGS,
        ...source.cameraSettings,
        [key]: value,
      },
    };
  });
}

function applyCameraLookTransformParameter(clip: TimelineClip, property: string, value: number): boolean {
  if (clip.source?.type !== 'camera') {
    return false;
  }

  const rotationAxis = getCameraLookRotationAxis(property);
  if (!rotationAxis) {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const engineState = useEngineStore.getState();
  if (engineState.sceneNavNoKeyframes) {
    engineState.setSceneCameraLiveOverride(clip.id, {
      rotation: { [rotationAxis]: value },
    });
    engine.requestRender();
    return true;
  }

  const mediaStore = useMediaStore.getState();
  const activeComp = mediaStore.getActiveComposition?.()
    ?? (mediaStore.compositions ?? []).find((composition) => composition.id === mediaStore.activeCompositionId);
  const clipLocalTime = timelineStore.playheadPosition - (clip.startTime ?? 0);
  const currentTransform = timelineStore.getInterpolatedTransform(clip.id, clipLocalTime);
  const updates = resolveCameraLookAtFixedEyeUpdates(
    clip,
    currentTransform,
    { [rotationAxis]: value },
    {
      width: activeComp?.width ?? 1920,
      height: activeComp?.height ?? 1080,
    },
  );

  if (!updates) {
    return false;
  }

  const needsKeyframePath = updates.some(({ property: updateProperty }) =>
    timelineStore.hasKeyframes(clip.id, updateProperty) ||
    timelineStore.isRecording(clip.id, updateProperty),
  ) || CAMERA_POSE_TRANSFORM_PROPERTIES.some((poseProperty) =>
    timelineStore.hasKeyframes(clip.id, poseProperty) ||
    timelineStore.isRecording(clip.id, poseProperty),
  );

  if (needsKeyframePath) {
    updates.forEach(({ property: updateProperty, value: updateValue }) => {
      timelineStore.addKeyframe(clip.id, updateProperty, updateValue);
    });
  } else {
    timelineStore.updateClipTransform(
      clip.id,
      buildCameraTransformPatchFromUpdates(currentTransform, updates),
    );
  }

  return true;
}

function applyGaussianSplatParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('gaussian.render.')) {
    return false;
  }

  const key = property.slice('gaussian.render.'.length);
  if (
    key !== 'splatScale' &&
    key !== 'maxSplats' &&
    key !== 'sortFrequency' &&
    key !== 'nearPlane' &&
    key !== 'farPlane'
  ) {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'gaussian-splat') {
      return null;
    }

    const currentSettings = source.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
    return {
      ...source,
      gaussianSplatSettings: {
        ...currentSettings,
        render: {
          ...currentSettings.render,
          [key]: roundIntegerParameter(property, value),
        },
      },
    };
  });
}

function applySplatEffectorParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('splatEffector.')) {
    return false;
  }

  const key = property.slice('splatEffector.'.length);
  if (key !== 'strength' && key !== 'falloff' && key !== 'speed' && key !== 'seed') {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'splat-effector') {
      return null;
    }

    return {
      ...source,
      splatEffectorSettings: {
        ...(source.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS),
        [key]: roundIntegerParameter(property, value),
      },
    };
  });
}

function applyText3DParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('text3d.')) {
    return false;
  }

  const key = property.slice('text3d.'.length) as keyof Text3DProperties;
  const numericKeys = new Set<keyof Text3DProperties>([
    'size',
    'depth',
    'letterSpacing',
    'lineHeight',
    'curveSegments',
    'bevelThickness',
    'bevelSize',
    'bevelSegments',
  ]);

  if (!numericKeys.has(key)) {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return false;
  }

  const currentText3D = clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES;
  timelineStore.updateText3DProperties(clipId, {
    [key]: roundIntegerParameter(property, value),
  } as Partial<Text3DProperties>);

  return currentText3D !== null;
}

function applyBlendshapeParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('blendshape.')) {
    return false;
  }

  const blendshapeName = property.slice('blendshape.'.length);
  if (!blendshapeName) {
    return false;
  }

  return updateClipSource(clipId, (source) => {
    if (source.type !== 'gaussian-avatar') {
      return null;
    }

    const clampedValue = Math.max(0, Math.min(1, value));
    const nextBlendshapes = {
      ...(source.gaussianBlendshapes ?? {}),
      [blendshapeName]: clampedValue,
    };
    if (clampedValue === 0) {
      delete nextBlendshapes[blendshapeName];
    }

    return {
      ...source,
      gaussianBlendshapes: nextBlendshapes,
    };
  });
}

function applyMaskParameter(clipId: string, property: string, value: number): boolean {
  if (!property.startsWith('mask.')) {
    return false;
  }

  const [, maskId, ...keyParts] = property.split('.');
  const key = keyParts.join('.');
  if (!maskId) {
    return false;
  }

  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  const mask = clip?.masks?.find((candidate) => candidate.id === maskId);
  if (!mask) {
    return false;
  }

  if (key === 'opacity') {
    timelineStore.updateMask(clipId, maskId, { opacity: value });
    return true;
  }

  if (key === 'feather') {
    timelineStore.updateMask(clipId, maskId, { feather: value });
    return true;
  }

  if (key === 'featherQuality') {
    timelineStore.updateMask(clipId, maskId, { featherQuality: roundIntegerParameter(property, value) });
    return true;
  }

  if (key === 'position.x') {
    timelineStore.updateMask(clipId, maskId, { position: { ...mask.position, x: value } });
    return true;
  }

  if (key === 'position.y') {
    timelineStore.updateMask(clipId, maskId, { position: { ...mask.position, y: value } });
    return true;
  }

  return false;
}

function applyCustomMIDIParameter(clip: TimelineClip, property: string, value: number): boolean {
  return (
    applyCameraLookTransformParameter(clip, property, value) ||
    applyCameraParameter(clip.id, property, value) ||
    applyGaussianSplatParameter(clip.id, property, value) ||
    applySplatEffectorParameter(clip.id, property, value) ||
    applyText3DParameter(clip.id, property, value) ||
    applyBlendshapeParameter(clip.id, property, value) ||
    applyMaskParameter(clip.id, property, value)
  );
}

export async function triggerMIDIParameterBinding(
  binding: MIDIParameterBinding,
  midiValue: number
): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === binding.clipId);
  if (!clip) {
    return;
  }

  const value = mapMIDIValueToParameter(binding, midiValue);
  const properties = binding.properties && binding.properties.length > 0
    ? binding.properties
    : [binding.property];

  properties.forEach((property) => {
    if (applyCustomMIDIParameter(clip, property, value)) {
      return;
    }

    timelineStore.setPropertyValue(binding.clipId, property as AnimatableProperty, value);
  });
}
