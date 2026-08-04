// Transform Tab - Position, Scale, Rotation, Opacity controls
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { parseFbxMeshNames } from '../../../engine/native3d/assets/modelRuntimeCache/fbx';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../../stores/mediaStore/types';
import {
  getSceneNavFpsMoveSpeedStepIndex,
  selectSceneNavFpsMode,
  selectSceneNavFpsMoveSpeed,
  selectSceneNavNoKeyframes,
  useEngineStore,
} from '../../../stores/engineStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import type { BlendMode, AnimatableProperty } from '../../../types';
import type { MIDIParameterTarget } from '../../../types/midi';
import {
  clampCameraFov,
  fullFrameFocalLengthMmToFov,
} from '../../../utils/cameraLens';
import { CameraSettingsSection } from './transformTab/CameraSettingsSection';
import { OptionsSection } from './transformTab/OptionsSection';
import { PositionSection } from './transformTab/PositionSection';
import { RotationSection } from './transformTab/RotationSection';
import { ScaleSection } from './transformTab/ScaleSection';
import { useCameraKeyframeInteractions } from './transformTab/useCameraKeyframeInteractions';
import {
  resolveCameraValues,
  resolvePositionValues,
  resolveScaleValues,
} from './transformTab/transformValues';
import { calculateFitToFrameScale } from '../../../utils/sourcePixelScale';
import {
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
} from '../../../stores/timeline/helpers/linkedClipSpeed';

function positiveDimension(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

interface TransformTabProps {
  clipId: string;
  transform: {
    opacity: number;
    blendMode: BlendMode;
    position: { x: number; y: number; z: number };
    scale: { all?: number; x: number; y: number; z?: number };
    rotation: { x: number; y: number; z: number };
  };
  speed?: number;
  is3D?: boolean;
  hasKeyframes?: boolean;
  cameraSettings?: SceneCameraSettings;
}

export function TransformTab({
  clipId,
  transform,
  speed = 1,
  is3D = false,
  cameraSettings: cameraSettingsOverride,
}: TransformTabProps) {
  const {
    setPropertyValue,
    setClipSpeed,
    setLinkedClipSpeedEnabled,
    updateClipTransform,
    toggle3D,
    updateClip,
    hasKeyframes,
    isRecording,
    addKeyframe,
    removeKeyframe,
    getClipKeyframes,
    toggleKeyframeRecording,
  } = useTimelineStore.getState();
  const sceneNavFpsMode = useEngineStore(selectSceneNavFpsMode);
  const sceneNavFpsMoveSpeed = useEngineStore(selectSceneNavFpsMoveSpeed);
  const sceneNavNoKeyframes = useEngineStore(selectSceneNavNoKeyframes);
  const setSceneNavFpsMode = useEngineStore((s) => s.setSceneNavFpsMode);
  const setSceneNavFpsMoveSpeed = useEngineStore((s) => s.setSceneNavFpsMoveSpeed);
  const setSceneNavNoKeyframes = useEngineStore((s) => s.setSceneNavNoKeyframes);
  const sceneNavFpsMoveSpeedIndex = getSceneNavFpsMoveSpeedStepIndex(sceneNavFpsMoveSpeed);
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const linkedAudioSpeedEnabled = useTimelineStore((state) => {
    const pair = resolveLinkedVideoAudioPair(state.clips, clipId);
    return pair?.video.id === clipId ? isLinkedAudioFollowingVideo(pair) : undefined;
  });
  const wireframe = clip?.wireframe ?? false;
  const sourceType = clip?.source?.type;
  const supportsFreeRun = sourceType === 'video' && !clip?.source?.liveInputId;
  const freeRun = clip?.freeRun === true;
  const isModel = sourceType === 'model';
  const isCameraClip = sourceType === 'camera';
  const isLightClip = sourceType === 'light';
  const isGaussianSplat = sourceType === 'gaussian-splat';
  const isSplatEffector = sourceType === 'splat-effector';
  const supportsThreeDEffectorToggle = isModel || isGaussianSplat;
  const canToggleThreeDEffectors = supportsThreeDEffectorToggle;
  const threeDEffectorsEnabled = clip?.source?.threeDEffectorsEnabled !== false;
  const supportsScaleZ = isModel || isSplatEffector || isGaussianSplat || isLightClip;
  const usesCameraControls = isCameraClip;
  const isLocked3D = isModel || isGaussianSplat || isSplatEffector || isLightClip;
  const isEffectively3D = isCameraClip || isLocked3D || is3D;
  const cameraSettings: SceneCameraSettings = isCameraClip
    ? (cameraSettingsOverride ?? clip?.source?.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS)
    : DEFAULT_SCENE_CAMERA_SETTINGS;
  const cameraValues = resolveCameraValues(cameraSettings);
  const modelFileName = clip?.source?.modelFileName ?? clip?.file?.name ?? clip?.name ?? '';
  const modelFile = clip?.source?.file ?? clip?.file;
  const [modelPrimitiveNames, setModelPrimitiveNames] = useState<string[]>([]);

  const handleBatchStart = useCallback(() => startBatch('Adjust transform'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);

  const mediaState = useMediaStore.getState();
  const activeComp = mediaState.getActiveComposition();
  const compWidth = activeComp?.width || 1920;
  const compHeight = activeComp?.height || 1080;
  const mediaFileId = clip?.source?.mediaFileId ?? clip?.mediaFileId;
  const mediaFile = mediaFileId
    ? (mediaState.files ?? []).find((candidate) => candidate.id === mediaFileId)
    : undefined;
  const nestedComposition = clip?.compositionId
    ? (mediaState.compositions ?? []).find((candidate) => candidate.id === clip.compositionId)
    : undefined;
  const sourceWidth =
    positiveDimension(mediaFile?.width)
    ?? positiveDimension(clip?.source?.videoElement?.videoWidth)
    ?? positiveDimension(clip?.source?.imageElement?.naturalWidth)
    ?? positiveDimension(clip?.source?.nativeDecoder?.width)
    ?? positiveDimension(clip?.source?.textCanvas?.width)
    ?? positiveDimension(nestedComposition?.width);
  const sourceHeight =
    positiveDimension(mediaFile?.height)
    ?? positiveDimension(clip?.source?.videoElement?.videoHeight)
    ?? positiveDimension(clip?.source?.imageElement?.naturalHeight)
    ?? positiveDimension(clip?.source?.nativeDecoder?.height)
    ?? positiveDimension(clip?.source?.textCanvas?.height)
    ?? positiveDimension(nestedComposition?.height);
  const fitToFrameScale = sourceWidth !== null && sourceHeight !== null
    ? calculateFitToFrameScale(
        sourceWidth,
        sourceHeight,
        compWidth,
        compHeight,
      )
    : null;

  const handlePropertyChange = useCallback((property: AnimatableProperty, value: number) => {
    setPropertyValue(clipId, property, value);
  }, [clipId, setPropertyValue]);

  const createMIDIParameterTarget = useCallback((
    property: string,
    label: string,
    currentValue: number,
    min?: number,
    max?: number,
    properties?: string[],
  ): MIDIParameterTarget => ({
      clipId,
      property,
      properties,
      label: `${clip?.name ?? 'Clip'} / ${label}`,
      currentValue,
      min,
      max,
    }),
    [clip?.name, clipId],
  );

  const positionValues = resolvePositionValues({
    transform,
    compWidth,
    compHeight,
    isEffectively3D,
    usesCameraControls,
  });
  const scaleValues = resolveScaleValues(transform);
  const selectedModelPrimitiveIndex = Number.isInteger(clip?.source?.modelPrimitiveIndex)
    ? clip?.source?.modelPrimitiveIndex
    : undefined;
  const modelPrimitiveOptions = useMemo(() => {
    const fallbackCount = selectedModelPrimitiveIndex !== undefined
      ? selectedModelPrimitiveIndex + 1
      : 0;
    const count = Math.max(modelPrimitiveNames.length, fallbackCount);
    return Array.from({ length: count }, (_, index) => ({
      index,
      label: modelPrimitiveNames[index] ?? `Mesh ${index + 1}`,
    }));
  }, [modelPrimitiveNames, selectedModelPrimitiveIndex]);

  useEffect(() => {
    let cancelled = false;
    if (!isModel || !modelFileName.toLowerCase().endsWith('.fbx') || !modelFile) {
      setModelPrimitiveNames([]);
      return () => {
        cancelled = true;
      };
    }

    void modelFile.arrayBuffer()
      .then((buffer) => {
        if (!cancelled) setModelPrimitiveNames(parseFbxMeshNames(buffer));
      })
      .catch(() => {
        if (!cancelled) setModelPrimitiveNames([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isModel, modelFile, modelFileName]);

  const handlePosXChange = (value: number) => handlePropertyChange(
    'position.x',
    positionValues.usesScenePositionUnits ? value : value / (compWidth / 2),
  );
  const handlePosYChange = (value: number) => handlePropertyChange(
    'position.y',
    positionValues.usesScenePositionUnits ? value : value / (compHeight / 2),
  );
  const handlePosZChange = (value: number) => handlePropertyChange(
    'position.z',
    positionValues.usesScenePositionUnits ? value : value / (compWidth / 2),
  );
  const handleCameraPositionXChange = (value: number) => handlePropertyChange('position.x', value);
  const handleCameraPositionYChange = (value: number) => handlePropertyChange('position.y', value);
  const handleCameraPositionZChange = (value: number) => handlePropertyChange('position.z', value);
  const handleCameraFovChange = useCallback((value: number) => {
    handlePropertyChange('camera.fov', clampCameraFov(value));
  }, [handlePropertyChange]);
  const handleCameraFocalLengthChange = useCallback((value: number) => {
    handlePropertyChange('camera.fov', fullFrameFocalLengthMmToFov(value));
  }, [handlePropertyChange]);
  const handleCameraNearChange = useCallback((value: number) => {
    handlePropertyChange('camera.near', Math.max(0.001, value));
  }, [handlePropertyChange]);
  const handleCameraFarChange = useCallback((value: number) => {
    handlePropertyChange('camera.far', Math.max(cameraSettings.near + 0.1, value));
  }, [cameraSettings.near, handlePropertyChange]);
  const handleCameraResolutionWidthChange = useCallback((value: number) => {
    handlePropertyChange('camera.resolutionWidth', Math.max(1, Math.round(value)));
  }, [handlePropertyChange]);
  const handleCameraResolutionHeightChange = useCallback((value: number) => {
    handlePropertyChange('camera.resolutionHeight', Math.max(1, Math.round(value)));
  }, [handlePropertyChange]);

  const {
    clearCameraKeyframesAndStopwatches,
    handleCameraLookRotationChange,
    handleSetAllCameraKeyframes,
  } = useCameraKeyframeInteractions({
    clip,
    clipId,
    compWidth,
    compHeight,
    transform,
    cameraSettings,
    cameraResolutionWidth: cameraValues.resolutionWidth,
    cameraResolutionHeight: cameraValues.resolutionHeight,
    usesCameraControls,
    hasKeyframes,
    isRecording,
    addKeyframe,
    removeKeyframe,
    getClipKeyframes,
    toggleKeyframeRecording,
    onPropertyChange: handlePropertyChange,
    updateCameraTransform: (patch) => updateClipTransform(clipId, patch),
  });

  const handleResetAll = useCallback(() => {
    if (usesCameraControls) {
      startBatch('Reset camera transform');
      try {
        clearCameraKeyframesAndStopwatches();
        updateClipTransform(clipId, {
          position: { x: 0, y: 0, z: 1 },
          scale: { all: 1, x: 1, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        });
      } finally {
        endBatch();
      }
      return;
    }

    updateClipTransform(clipId, {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: supportsScaleZ ? { all: 1, x: 1, y: 1, z: 1 } : { all: 1, x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }, [clearCameraKeyframesAndStopwatches, clipId, supportsScaleZ, updateClipTransform, usesCameraControls]);

  const handleScaleAllChange = (pct: number) => handlePropertyChange('scale.all', pct / 100);
  const handleScaleXChange = (pct: number) => handlePropertyChange('scale.x', pct / 100);
  const handleScaleYChange = (pct: number) => handlePropertyChange('scale.y', pct / 100);
  const handleScaleZChange = (pct: number) => handlePropertyChange('scale.z', pct / 100);
  const toggleScaleAxis = (property: 'scale.x' | 'scale.y', value: number) => {
    const magnitude = Math.abs(value) || 1;
    handlePropertyChange(property, value < 0 ? magnitude : -magnitude);
  };
  const handleFitToFrame = fitToFrameScale === null
    ? undefined
    : () => {
        startBatch('Fit source to composition');
        try {
          handlePropertyChange('scale.all', 1);
          handlePropertyChange(
            'scale.x',
            (transform.scale.x < 0 ? -1 : 1) * fitToFrameScale,
          );
          handlePropertyChange(
            'scale.y',
            (transform.scale.y < 0 ? -1 : 1) * fitToFrameScale,
          );
        } finally {
          endBatch();
        }
      };

  const opacityPct = transform.opacity * 100;
  const handleOpacityChange = (pct: number) => handlePropertyChange('opacity', Math.max(0, Math.min(100, pct)) / 100);
  const speedPct = speed * 100;
  const handleSpeedChange = (pct: number) => setClipSpeed(clipId, pct / 100);
  const handleThreeDEffectorsToggle = useCallback(() => {
    if (!clip?.source) return;
    updateClip(clipId, {
      source: {
        ...clip.source,
        threeDEffectorsEnabled: !threeDEffectorsEnabled,
      },
    });
  }, [clip, clipId, threeDEffectorsEnabled, updateClip]);
  const handleModelPrimitiveIndexChange = useCallback((index: number | undefined) => {
    if (!clip?.source) return;
    const source = { ...clip.source };
    if (index === undefined) {
      delete source.modelPrimitiveIndex;
    } else {
      source.modelPrimitiveIndex = index;
    }
    updateClip(clipId, { source });
  }, [clip, clipId, updateClip]);

  return (
    <div
      className="properties-tab-content transform-tab-compact"
      data-guided-properties-tab="transform"
      data-guided-target="properties-tab:transform"
    >
      <OptionsSection
        clipId={clipId}
        blendMode={transform.blendMode}
        canToggleThreeDEffectors={canToggleThreeDEffectors}
        isCameraClip={isCameraClip}
        isEffectively3D={isEffectively3D}
        isLocked3D={isLocked3D}
        isModel={isModel}
        opacity={transform.opacity}
        opacityPct={opacityPct}
        modelPrimitiveIndex={selectedModelPrimitiveIndex}
        modelPrimitiveOptions={modelPrimitiveOptions}
        sceneNavFpsMode={sceneNavFpsMode}
        sceneNavFpsMoveSpeed={sceneNavFpsMoveSpeed}
        sceneNavFpsMoveSpeedIndex={sceneNavFpsMoveSpeedIndex}
        sceneNavNoKeyframes={sceneNavNoKeyframes}
        speed={speed}
        speedPct={speedPct}
        linkedAudioSpeedEnabled={linkedAudioSpeedEnabled}
        supportsFreeRun={supportsFreeRun}
        freeRun={freeRun}
        supportsThreeDEffectorToggle={supportsThreeDEffectorToggle}
        threeDEffectorsEnabled={threeDEffectorsEnabled}
        wireframe={wireframe}
        createMidiTarget={createMIDIParameterTarget}
        onBatchEnd={handleBatchEnd}
        onBatchStart={handleBatchStart}
        onBlendModeChange={(blendMode) => updateClipTransform(clipId, { blendMode: blendMode as BlendMode })}
        onModelPrimitiveIndexChange={handleModelPrimitiveIndexChange}
        onOpacityChange={handleOpacityChange}
        onResetAll={handleResetAll}
        onSceneNavFpsModeChange={setSceneNavFpsMode}
        onSceneNavFpsMoveSpeedChange={setSceneNavFpsMoveSpeed}
        onSceneNavNoKeyframesChange={setSceneNavNoKeyframes}
        onSetAllCameraKeyframes={handleSetAllCameraKeyframes}
        onSpeedChange={handleSpeedChange}
        onLinkedAudioSpeedChange={(enabled) => setLinkedClipSpeedEnabled(clipId, enabled)}
        onFreeRunToggle={() => updateClip(clipId, { freeRun: !freeRun })}
        onThreeDEffectorsToggle={handleThreeDEffectorsToggle}
        onToggle3D={() => toggle3D(clipId)}
        onWireframeToggle={() => updateClip(clipId, { wireframe: !wireframe })}
      />

      {usesCameraControls && (
        <CameraSettingsSection
          camera={cameraValues}
          clipId={clipId}
          createMidiTarget={createMIDIParameterTarget}
          onBatchEnd={handleBatchEnd}
          onBatchStart={handleBatchStart}
          onCameraFarChange={handleCameraFarChange}
          onCameraFocalLengthChange={handleCameraFocalLengthChange}
          onCameraFovChange={handleCameraFovChange}
          onCameraNearChange={handleCameraNearChange}
          onCameraResolutionHeightChange={handleCameraResolutionHeightChange}
          onCameraResolutionWidthChange={handleCameraResolutionWidthChange}
        />
      )}

      <PositionSection
        clipId={clipId}
        createMidiTarget={createMIDIParameterTarget}
        isEffectively3D={isEffectively3D}
        positionValues={positionValues}
        transform={transform}
        usesCameraControls={usesCameraControls}
        onBatchEnd={handleBatchEnd}
        onBatchStart={handleBatchStart}
        onCameraPositionXChange={handleCameraPositionXChange}
        onCameraPositionYChange={handleCameraPositionYChange}
        onCameraPositionZChange={handleCameraPositionZChange}
        onPosXChange={handlePosXChange}
        onPosYChange={handlePosYChange}
        onPosZChange={handlePosZChange}
      />

      {!usesCameraControls && (
        <ScaleSection
          clipId={clipId}
          createMidiTarget={createMIDIParameterTarget}
          scaleValues={scaleValues}
          supportsScaleZ={supportsScaleZ}
          transform={transform}
          onBatchEnd={handleBatchEnd}
          onBatchStart={handleBatchStart}
          onScaleAllChange={handleScaleAllChange}
          onFitToFrame={handleFitToFrame}
          onFlipX={() => toggleScaleAxis('scale.x', transform.scale.x)}
          onFlipY={() => toggleScaleAxis('scale.y', transform.scale.y)}
          onScaleXChange={handleScaleXChange}
          onScaleYChange={handleScaleYChange}
          onScaleZChange={handleScaleZChange}
        />
      )}

      <RotationSection
        clipId={clipId}
        createMidiTarget={createMIDIParameterTarget}
        isEffectively3D={isEffectively3D}
        transform={transform}
        usesCameraControls={usesCameraControls}
        onBatchEnd={handleBatchEnd}
        onBatchStart={handleBatchStart}
        onCameraLookRotationChange={handleCameraLookRotationChange}
        onRotationChange={handlePropertyChange}
      />

      {!usesCameraControls && (
        <div className="properties-actions">
          <button className="btn btn-sm" onClick={handleResetAll}>
            Reset All
          </button>
        </div>
      )}
    </div>
  );
}
