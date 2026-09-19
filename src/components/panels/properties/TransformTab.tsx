// Transform Tab - Position, Scale, Rotation, Opacity controls
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { parseFbxMeshNames } from '../../../engine/native3d/assets/modelRuntimeCache/fbx';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../../stores/mediaStore/types';
import {
  getSceneNavFpsMoveSpeedStepIndex,
  resolveSceneNavTouchControlsVisible,
  selectSceneNavFpsMode,
  selectSceneNavFpsMoveSpeed,
  selectSceneNavNoKeyframes,
  useEngineStore,
} from '../../../stores/engineStore';
import { useDockStore } from '../../../stores/dockStore';
import { isMobileLayoutId } from '../../dock/mobileLayoutOrientation';
import { startBatch, endBatch } from '../../../stores/historyStore';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { BlendMode } from '../../../types/blendMode';
import type { VideoInspectorSectionKey } from '../../../types/timeline';
import type { MIDIParameterTarget } from '../../../types/midi';
import {
  clampCameraFov,
  fullFrameFocalLengthMmToFov,
} from '../../../utils/cameraLens';
import { CameraSettingsSection } from './transformTab/CameraSettingsSection';
import { LiveInputTab } from './LiveInputTab';
import { OptionsSection } from './transformTab/OptionsSection';
import { ResolveTransformSection } from './transformTab/ResolveTransformSection';
import { ResolveVisualInspectorSections } from './transformTab/ResolveVideoInspectorSections';
import { SourceSection } from './transformTab/SourceSection';
import { useCameraKeyframeInteractions } from './transformTab/useCameraKeyframeInteractions';
import {
  resolveCameraValues,
  resolvePositionValues,
} from './transformTab/transformValues';
import { calculateFitToFrameScale } from '../../../utils/sourcePixelScale';
import {
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
} from '../../../stores/timeline/helpers/linkedClipSpeed';
import { isVideoInspectorSectionEnabled } from '../../../services/videoInspector/sectionBypass';

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
    anchor?: { x: number; y: number; z: number };
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
    disablePropertyKeyframes,
  } = useTimelineStore.getState();
  const sceneNavFpsMode = useEngineStore(selectSceneNavFpsMode);
  const sceneNavFpsMoveSpeed = useEngineStore(selectSceneNavFpsMoveSpeed);
  const sceneNavNoKeyframes = useEngineStore(selectSceneNavNoKeyframes);
  const sceneNavTouchControlsOverride = useEngineStore((s) => s.sceneNavTouchControlsOverride);
  const activeDockLayoutId = useDockStore((s) => s.activeSavedLayoutId);
  const setSceneNavFpsMode = useEngineStore((s) => s.setSceneNavFpsMode);
  const setSceneNavFpsMoveSpeed = useEngineStore((s) => s.setSceneNavFpsMoveSpeed);
  const setSceneNavNoKeyframes = useEngineStore((s) => s.setSceneNavNoKeyframes);
  const setSceneNavTouchControlsOverride = useEngineStore((s) => s.setSceneNavTouchControlsOverride);
  const sceneNavFpsMoveSpeedIndex = getSceneNavFpsMoveSpeedStepIndex(sceneNavFpsMoveSpeed);
  const sceneNavTouchControlsVisible = resolveSceneNavTouchControlsVisible(
    sceneNavTouchControlsOverride,
    isMobileLayoutId(activeDockLayoutId),
  );
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
  const selectedMeshType = clip?.meshType ?? clip?.source?.meshType;
  const isText3D = isModel && selectedMeshType === 'text3d';
  const isCameraClip = sourceType === 'camera';
  const isLightClip = sourceType === 'light';
  const isGaussianSplat = sourceType === 'gaussian-splat';
  const isSplatEffector = sourceType === 'splat-effector';
  const supportsThreeDEffectorToggle = isModel || isGaussianSplat;
  const canToggleThreeDEffectors = supportsThreeDEffectorToggle;
  const threeDEffectorsEnabled = clip?.source?.threeDEffectorsEnabled !== false;
  const supportsScaleZ = isModel || isSplatEffector || isGaussianSplat || isLightClip;
  const usesCameraControls = isCameraClip;
  // Flock swarms only exist inside the shared 3D scene; switching them to 2D would drop them.
  const isLocked3D = isModel || isGaussianSplat || isSplatEffector || isLightClip || sourceType === 'flock';
  const isEffectively3D = isCameraClip || isLocked3D || is3D;
  const usesVisualInspectorSections = sourceType === 'video'
    || sourceType === 'image'
    || sourceType === 'text'
    || isText3D;
  const cameraSettings: SceneCameraSettings = isCameraClip
    ? (cameraSettingsOverride ?? clip?.source?.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS)
    : DEFAULT_SCENE_CAMERA_SETTINGS;
  const cameraValues = resolveCameraValues(cameraSettings);
  const modelFileName = clip?.source?.modelFileName ?? clip?.file?.name ?? clip?.name ?? '';
  const modelFile = clip?.source?.file ?? clip?.file;
  const [modelPrimitiveNames, setModelPrimitiveNames] = useState<string[]>([]);

  const handleBatchStart = useCallback(() => startBatch('Adjust transform'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);
  const handleInspectorSectionEnabledChange = useCallback((
    section: VideoInspectorSectionKey,
    enabled: boolean,
  ) => {
    updateClip(clipId, {
      videoInspectorSections: {
        ...clip?.videoInspectorSections,
        [section]: enabled,
      },
    });
  }, [clip?.videoInspectorSections, clipId, updateClip]);

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
  const {
    handleCameraLookRotationChange,
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

  const handleResetProperties = useCallback((
    label: string,
    entries: Array<{ property: AnimatableProperty; value: number }>,
  ) => {
    startBatch(label);
    try {
      entries.forEach(({ property, value }) => {
        disablePropertyKeyframes(clipId, property, value);
      });
    } finally {
      endBatch();
    }
  }, [clipId, disablePropertyKeyframes]);

  const handleResetCameraLens = useCallback(() => {
    handleResetProperties('Reset camera lens', [{
      property: 'camera.fov',
      value: DEFAULT_SCENE_CAMERA_SETTINGS.fov,
    }]);
  }, [handleResetProperties]);

  const handleScaleAllChange = (value: number) => handlePropertyChange('scale.all', value);
  const handleScaleXChange = (value: number) => handlePropertyChange('scale.x', value);
  const handleScaleYChange = (value: number) => handlePropertyChange('scale.y', value);
  const handleScaleZChange = (value: number) => handlePropertyChange('scale.z', value);
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

  const handleResetComposite = useCallback(() => {
    startBatch('Reset composite');
    try {
      disablePropertyKeyframes(clipId, 'opacity', 1);
      updateClipTransform(clipId, { blendMode: 'normal' });
    } finally {
      endBatch();
    }
  }, [clipId, disablePropertyKeyframes, updateClipTransform]);
  const handleResetSpeed = useCallback(() => {
    handleResetProperties('Reset speed', [{ property: 'speed', value: 1 }]);
  }, [handleResetProperties]);

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
      {sourceType === 'video' && (
        <SourceSection
          clipId={clipId}
          freeRun={freeRun}
          isEffectively3D={isEffectively3D}
          isLocked3D={isLocked3D}
          mediaFileId={mediaFileId}
          supportsFreeRun={supportsFreeRun}
          onFreeRunToggle={() => updateClip(clipId, { freeRun: !freeRun })}
          onToggle3D={() => toggle3D(clipId)}
        />
      )}

      {clip?.source?.liveInputId && <LiveInputTab clipId={clipId} embedded />}

      {(!usesVisualInspectorSections || isText3D) && (
        <OptionsSection
          clipId={clipId}
          blendMode={transform.blendMode}
          canToggleThreeDEffectors={canToggleThreeDEffectors}
          isCameraClip={isCameraClip}
          isEffectively3D={isEffectively3D}
          isLocked3D={isLocked3D}
          isModel={isModel}
          inspectorOnly={usesVisualInspectorSections}
          layerModeControlsInSource={false}
          opacity={transform.opacity}
          opacityPct={opacityPct}
          modelPrimitiveIndex={selectedModelPrimitiveIndex}
          modelPrimitiveOptions={modelPrimitiveOptions}
          sceneNavFpsMode={sceneNavFpsMode}
          sceneNavFpsMoveSpeed={sceneNavFpsMoveSpeed}
          sceneNavFpsMoveSpeedIndex={sceneNavFpsMoveSpeedIndex}
          sceneNavNoKeyframes={sceneNavNoKeyframes}
          sceneNavTouchControlsVisible={sceneNavTouchControlsVisible}
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
          onSceneNavFpsModeChange={setSceneNavFpsMode}
          onSceneNavFpsMoveSpeedChange={setSceneNavFpsMoveSpeed}
          onSceneNavNoKeyframesChange={setSceneNavNoKeyframes}
          onSceneNavTouchControlsVisibleChange={setSceneNavTouchControlsOverride}
          onSpeedChange={handleSpeedChange}
          onLinkedAudioSpeedChange={(enabled) => setLinkedClipSpeedEnabled(clipId, enabled)}
          onFreeRunToggle={() => updateClip(clipId, { freeRun: !freeRun })}
          onThreeDEffectorsToggle={handleThreeDEffectorsToggle}
          onToggle3D={() => toggle3D(clipId)}
          onWireframeToggle={() => updateClip(clipId, { wireframe: !wireframe })}
        />
      )}

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
          onResetLens={handleResetCameraLens}
        />
      )}

      <ResolveTransformSection
        clipId={clipId}
        createMidiTarget={createMIDIParameterTarget}
        enabled={isVideoInspectorSectionEnabled(clip?.videoInspectorSections, 'transform')}
        isEffectively3D={isEffectively3D}
        isLocked3D={isLocked3D}
        positionValues={positionValues}
        showLayerDimensionToggle={usesVisualInspectorSections}
        supportsScaleZ={supportsScaleZ}
        transform={transform}
        usesCameraControls={usesCameraControls}
        onBatchEnd={handleBatchEnd}
        onBatchStart={handleBatchStart}
        onCameraPositionXChange={handleCameraPositionXChange}
        onCameraPositionYChange={handleCameraPositionYChange}
        onCameraPositionZChange={handleCameraPositionZChange}
        onCameraLookRotationChange={handleCameraLookRotationChange}
        onAnchorChange={handlePropertyChange}
        onFitToFrame={handleFitToFrame}
        onFlipX={() => toggleScaleAxis('scale.x', transform.scale.x)}
        onFlipY={() => toggleScaleAxis('scale.y', transform.scale.y)}
        onEnabledChange={enabled => handleInspectorSectionEnabledChange('transform', enabled)}
        onPosXChange={handlePosXChange}
        onPosYChange={handlePosYChange}
        onPosZChange={handlePosZChange}
        onResetProperties={handleResetProperties}
        onRotationChange={handlePropertyChange}
        onScaleAllChange={handleScaleAllChange}
        onScaleXChange={handleScaleXChange}
        onScaleYChange={handleScaleYChange}
        onScaleZChange={handleScaleZChange}
        onToggle3D={() => toggle3D(clipId)}
      />

      {usesVisualInspectorSections && (
        <ResolveVisualInspectorSections
          blendMode={transform.blendMode}
          clipId={clipId}
          createMidiTarget={createMIDIParameterTarget}
          linkedAudioSpeedEnabled={linkedAudioSpeedEnabled}
          opacity={transform.opacity}
          sections={clip?.videoInspectorSections}
          sourceHeight={sourceHeight ?? compHeight}
          sourceWidth={sourceWidth ?? compWidth}
          speed={speed}
          showTemporalSections={sourceType === 'video'}
          onBatchEnd={handleBatchEnd}
          onBatchStart={handleBatchStart}
          onBlendModeChange={blendMode => updateClipTransform(clipId, { blendMode: blendMode as BlendMode })}
          onLinkedAudioSpeedChange={enabled => setLinkedClipSpeedEnabled(clipId, enabled)}
          onOpacityChange={handleOpacityChange}
          onSectionEnabledChange={handleInspectorSectionEnabledChange}
          onResetComposite={handleResetComposite}
          onResetSpeed={handleResetSpeed}
          onSpeedChange={handleSpeedChange}
        />
      )}
    </div>
  );
}
