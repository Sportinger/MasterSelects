import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useEngineStore } from '../../stores/engineStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { engine } from '../../engine/WebGPUEngine';
import { DEFAULT_TEXT_3D_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../engine/gaussian/types';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { getInterpolatedClipTransform, interpolateKeyframes } from '../../utils/keyframeInterpolation';
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
import type { AnimatableProperty, ClipTransform, Text3DProperties, TimelineClip } from '../../types';

type ClipSource = NonNullable<TimelineClip['source']>;

const MIDI_PARAMETER_DAMPING_TIME_CONSTANT_MS = 90;
const MIDI_PARAMETER_DAMPING_MIN_EPSILON = 0.0001;
const MIDI_PARAMETER_DAMPING_FALLBACK_DELTA_MS = 1000 / 60;
const MIDI_PARAMETER_DAMPING_MAX_DELTA_MS = 50;

interface MIDIParameterDampingState {
  binding: MIDIParameterBinding;
  currentValue: number;
  targetValue: number;
  lastTimestamp: number | null;
  frameId: number | null;
}

const dampedMIDIParameterStates = new Map<string, MIDIParameterDampingState>();

function getFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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

function resolveDampingEpsilon(binding: MIDIParameterBinding): number {
  const { min, max } = resolveParameterRange(binding);
  return Math.max(Math.abs(max - min) * 0.0005, MIDI_PARAMETER_DAMPING_MIN_EPSILON);
}

function getDampingStepFactor(deltaMs: number): number {
  const safeDeltaMs = !Number.isFinite(deltaMs) || deltaMs <= 0
    ? MIDI_PARAMETER_DAMPING_FALLBACK_DELTA_MS
    : Math.min(deltaMs, MIDI_PARAMETER_DAMPING_MAX_DELTA_MS);

  return Math.min(1, 1 - Math.exp(-safeDeltaMs / MIDI_PARAMETER_DAMPING_TIME_CONSTANT_MS));
}

function cancelAnimationFrameIfAvailable(frameId: number | null): void {
  if (frameId === null || typeof globalThis.cancelAnimationFrame !== 'function') {
    return;
  }

  globalThis.cancelAnimationFrame(frameId);
}

export function cancelDampedMIDIParameterBinding(bindingId: string): void {
  const state = dampedMIDIParameterStates.get(bindingId);
  if (!state) {
    return;
  }

  cancelAnimationFrameIfAvailable(state.frameId);
  dampedMIDIParameterStates.delete(bindingId);
}

export function resetDampedMIDIParameterBindings(): void {
  dampedMIDIParameterStates.forEach((state) => {
    cancelAnimationFrameIfAvailable(state.frameId);
  });
  dampedMIDIParameterStates.clear();
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

function getClipBaseTransform(clip: TimelineClip): ClipTransform {
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

function getTransformParameterValue(transform: ClipTransform, property: string): number | null {
  if (property === 'opacity') {
    return getFiniteNumber(transform.opacity);
  }

  if (property.startsWith('position.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    return getFiniteNumber(transform.position?.[axis]);
  }

  if (property.startsWith('scale.')) {
    const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
    if (axis === 'all') {
      return getFiniteNumber(transform.scale?.all ?? 1);
    }
    return getFiniteNumber(transform.scale?.[axis]);
  }

  if (property.startsWith('rotation.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    return getFiniteNumber(transform.rotation?.[axis]);
  }

  return null;
}

function resolveTransformParameterValue(clip: TimelineClip, property: string): number | null {
  const timelineStore = useTimelineStore.getState();

  if (property.startsWith('rotation.') && clip.source?.type === 'camera' && useEngineStore.getState().sceneNavNoKeyframes) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    const liveOverride = useEngineStore.getState().sceneCameraLiveOverrides[clip.id]?.rotation?.[axis];
    const liveValue = getFiniteNumber(liveOverride);
    if (liveValue !== null) {
      return liveValue;
    }
  }

  if (
    property === 'opacity' ||
    property.startsWith('position.') ||
    property.startsWith('scale.') ||
    property.startsWith('rotation.')
  ) {
    const animatableProperty = property as AnimatableProperty;
    if (
      timelineStore.hasKeyframes(clip.id, animatableProperty) ||
      timelineStore.isRecording(clip.id, animatableProperty)
    ) {
      const keyframes = timelineStore.clipKeyframes.get(clip.id) ?? [];
      const clipLocalTime = timelineStore.playheadPosition - (clip.startTime ?? 0);
      const baseTransform = getClipBaseTransform(clip);
      const interpolatedTransform = getInterpolatedClipTransform(
        keyframes,
        clipLocalTime,
        baseTransform,
        {
          rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear',
        },
      );

      return getTransformParameterValue(interpolatedTransform, property);
    }
  }

  if (property === 'opacity') {
    return getFiniteNumber(clip.transform?.opacity);
  }

  if (property.startsWith('position.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    return getFiniteNumber(clip.transform?.position?.[axis]);
  }

  if (property.startsWith('scale.')) {
    const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
    if (axis === 'all') {
      return getFiniteNumber(clip.transform?.scale?.all ?? 1);
    }
    return getFiniteNumber(clip.transform?.scale?.[axis]);
  }

  if (property.startsWith('rotation.')) {
    const axis = property.split('.')[1] as 'x' | 'y' | 'z';
    if (clip.source?.type === 'camera' && useEngineStore.getState().sceneNavNoKeyframes) {
      const liveOverride = useEngineStore.getState().sceneCameraLiveOverrides[clip.id]?.rotation?.[axis];
      const liveValue = getFiniteNumber(liveOverride);
      if (liveValue !== null) {
        return liveValue;
      }
    }

    return getFiniteNumber(clip.transform?.rotation?.[axis]);
  }

  return null;
}

function resolveEffectParameterValue(clip: TimelineClip, property: string): number | null {
  if (!property.startsWith('effect.')) {
    return null;
  }

  const [, effectId, paramName] = property.split('.');
  if (!effectId || !paramName) {
    return null;
  }

  const effect = clip.effects?.find((candidate) => candidate.id === effectId);
  const baseValue = getFiniteNumber(effect?.params?.[paramName]);
  if (baseValue === null) {
    return null;
  }

  const timelineStore = useTimelineStore.getState();
  const animatableProperty = property as AnimatableProperty;
  if (
    timelineStore.hasKeyframes(clip.id, animatableProperty) ||
    timelineStore.isRecording(clip.id, animatableProperty)
  ) {
    const keyframes = timelineStore.clipKeyframes.get(clip.id) ?? [];
    const clipLocalTime = timelineStore.playheadPosition - (clip.startTime ?? 0);
    return interpolateKeyframes(keyframes, animatableProperty, clipLocalTime, baseValue);
  }

  return baseValue;
}

function resolveCustomMIDIParameterValue(clip: TimelineClip, property: string): number | null {
  if (property === 'speed') {
    const timelineStore = useTimelineStore.getState();
    if (
      timelineStore.hasKeyframes(clip.id, 'speed') ||
      timelineStore.isRecording(clip.id, 'speed')
    ) {
      return timelineStore.getInterpolatedSpeed(clip.id, timelineStore.playheadPosition - (clip.startTime ?? 0));
    }

    return getFiniteNumber(clip.speed);
  }

  if (property.startsWith('camera.') && clip.source?.type === 'camera') {
    const key = property.slice('camera.'.length);
    if (key === 'fov' || key === 'near' || key === 'far') {
      return getFiniteNumber(clip.source.cameraSettings?.[key]);
    }
  }

  if (property.startsWith('gaussian.render.') && clip.source?.type === 'gaussian-splat') {
    const key = property.slice('gaussian.render.'.length) as keyof typeof DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
    const settings = clip.source.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
    return getFiniteNumber(settings.render[key]);
  }

  if (property.startsWith('splatEffector.') && clip.source?.type === 'splat-effector') {
    const key = property.slice('splatEffector.'.length) as keyof typeof DEFAULT_SPLAT_EFFECTOR_SETTINGS;
    const settings = clip.source.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS;
    return getFiniteNumber(settings[key]);
  }

  if (property.startsWith('text3d.')) {
    const key = property.slice('text3d.'.length) as keyof Text3DProperties;
    const text3DProperties = clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES;
    return getFiniteNumber(text3DProperties[key]);
  }

  if (property.startsWith('blendshape.') && clip.source?.type === 'gaussian-avatar') {
    const blendshapeName = property.slice('blendshape.'.length);
    return getFiniteNumber(clip.source.gaussianBlendshapes?.[blendshapeName]) ?? 0;
  }

  if (property.startsWith('mask.')) {
    const [, maskId, ...keyParts] = property.split('.');
    const key = keyParts.join('.');
    const mask = clip.masks?.find((candidate) => candidate.id === maskId);

    if (!mask) {
      return null;
    }

    if (key === 'opacity') {
      return getFiniteNumber(mask.opacity);
    }

    if (key === 'feather') {
      return getFiniteNumber(mask.feather);
    }

    if (key === 'featherQuality') {
      return getFiniteNumber(mask.featherQuality);
    }

    if (key === 'position.x') {
      return getFiniteNumber(mask.position?.x);
    }

    if (key === 'position.y') {
      return getFiniteNumber(mask.position?.y);
    }
  }

  return null;
}

function resolveMIDIParameterCurrentValue(binding: MIDIParameterBinding, fallbackValue: number): number {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === binding.clipId);
  if (!clip) {
    return fallbackValue;
  }

  const value =
    resolveTransformParameterValue(clip, binding.property) ??
    resolveEffectParameterValue(clip, binding.property) ??
    resolveCustomMIDIParameterValue(clip, binding.property) ??
    getFiniteNumber(binding.currentValue);

  return value ?? fallbackValue;
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

function applyMIDIParameterBindingValue(binding: MIDIParameterBinding, value: number): boolean {
  const timelineStore = useTimelineStore.getState();
  const clip = timelineStore.clips.find((candidate) => candidate.id === binding.clipId);
  if (!clip) {
    return false;
  }

  const properties = binding.properties && binding.properties.length > 0
    ? binding.properties
    : [binding.property];

  properties.forEach((property) => {
    if (applyCustomMIDIParameter(clip, property, value)) {
      return;
    }

    timelineStore.setPropertyValue(binding.clipId, property as AnimatableProperty, value);
  });

  return true;
}

function scheduleDampedMIDIParameterFrame(bindingId: string): void {
  const state = dampedMIDIParameterStates.get(bindingId);
  if (!state || state.frameId !== null) {
    return;
  }

  if (typeof globalThis.requestAnimationFrame !== 'function') {
    applyMIDIParameterBindingValue(state.binding, state.targetValue);
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  state.frameId = globalThis.requestAnimationFrame((timestamp) => {
    runDampedMIDIParameterFrame(bindingId, timestamp);
  });
}

function runDampedMIDIParameterFrame(bindingId: string, timestamp: number): void {
  const state = dampedMIDIParameterStates.get(bindingId);
  if (!state) {
    return;
  }

  state.frameId = null;
  const deltaMs = state.lastTimestamp === null
    ? 0
    : Math.max(0, timestamp - state.lastTimestamp);
  state.lastTimestamp = timestamp;

  const epsilon = resolveDampingEpsilon(state.binding);
  const diff = state.targetValue - state.currentValue;
  if (Math.abs(diff) <= epsilon) {
    applyMIDIParameterBindingValue(state.binding, state.targetValue);
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  const nextValue = state.currentValue + diff * getDampingStepFactor(deltaMs);
  state.currentValue = nextValue;

  const didApply = applyMIDIParameterBindingValue(state.binding, nextValue);
  if (!didApply) {
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  if (Math.abs(state.targetValue - nextValue) <= epsilon) {
    applyMIDIParameterBindingValue(state.binding, state.targetValue);
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  scheduleDampedMIDIParameterFrame(bindingId);
}

function startDampedMIDIParameterBinding(binding: MIDIParameterBinding, targetValue: number): void {
  const existingState = dampedMIDIParameterStates.get(binding.id);
  const currentValue = existingState?.currentValue ?? resolveMIDIParameterCurrentValue(binding, targetValue);
  const state: MIDIParameterDampingState = existingState ?? {
    binding,
    currentValue,
    targetValue,
    lastTimestamp: null,
    frameId: null,
  };

  state.binding = binding;
  state.targetValue = targetValue;
  state.currentValue = currentValue;
  dampedMIDIParameterStates.set(binding.id, state);

  if (Math.abs(targetValue - currentValue) <= resolveDampingEpsilon(binding)) {
    applyMIDIParameterBindingValue(binding, targetValue);
    cancelDampedMIDIParameterBinding(binding.id);
    return;
  }

  scheduleDampedMIDIParameterFrame(binding.id);
}

export async function triggerMIDIParameterBinding(
  binding: MIDIParameterBinding,
  midiValue: number
): Promise<void> {
  const value = mapMIDIValueToParameter(binding, midiValue);

  if (binding.damping) {
    startDampedMIDIParameterBinding(binding, value);
    return;
  }

  cancelDampedMIDIParameterBinding(binding.id);
  applyMIDIParameterBindingValue(binding, value);
}
