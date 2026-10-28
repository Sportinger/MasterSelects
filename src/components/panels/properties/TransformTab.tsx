// Transform Tab - Position, Scale, Rotation, Opacity controls
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getCanvasSourceSize } from '../../../services/text/textCanvasFrameRegistry';

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
import { CameraShakeSection } from './transformTab/CameraShakeSection';
import { CameraLensSection } from './transformTab/CameraLensSection';
import { LiveInputTab } from './LiveInputTab';
import { OptionsSection } from './transformTab/OptionsSection';
import { ResolveTransformSection } from './transformTab/ResolveTransformSection';
import { ResolveVisualInspectorSections } from './transformTab/ResolveVideoInspectorSections';
import { SourceSection } from './transformTab/SourceSection';
import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
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
import { useStableHandler } from './transformTab/useStableHandler';
import { useTransformMediaSizes } from './transformTab/useTransformMediaSizes';

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

/**
 * Memoised, like its sections: pass a transform that keeps its identity while its values stay the
 * same (PropertiesPanel uses useStableTransform), so playhead ticks and edits of other clips skip it,
 * and a drag re-renders only the section whose values change.
 */
export const TransformTab = memo(function TransformTab({
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
  // A media clip that is still restoring has no source yet; keep its video/image
  // inspector (crop, free run, 3D) instead of the generic fallback layout.
  const pendingSourceType = useMediaStore((state) => {
    if (!clip || clip.source) return undefined;
    if (clip.isComposition) return 'video';
    const file = clip.mediaFileId ? state.files.find((candidate) => candidate.id === clip.mediaFileId) : undefined;
    return file?.type === 'video' || file?.type === 'image' ? file.type : undefined;
  });
  const sourceType = clip?.source?.type ?? pendingSourceType;
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
  const handleInspectorSectionEnabledChange = useStableHandler((
    section: VideoInspectorSectionKey,
    enabled: boolean,
  ) => {
    updateClip(clipId, {
      videoInspectorSections: {
        ...clip?.videoInspectorSections,
        [section]: enabled,
      },
    });
  });

  // Subscribed, not read through getState(): the tab is memoised, so a composition resolution change,
  // media metadata or a proxy arriving, or a source swap must re-render it. Each selector returns one
  // number, so mirror writes of the composition list and edits of other files leave the tab alone.
  const { compWidth, compHeight, mediaFileId, mediaWidth, mediaHeight, nestedWidth, nestedHeight } = useTransformMediaSizes(clip);
  const textSourceSize = clip?.source?.textCanvas ? getCanvasSourceSize(clip.source.textCanvas) : undefined;
  const sourceWidth =
    positiveDimension(mediaWidth)
    ?? positiveDimension(clip?.source?.videoElement?.videoWidth)
    ?? positiveDimension(clip?.source?.imageElement?.naturalWidth)
    ?? positiveDimension(clip?.source?.nativeDecoder?.width)
    ?? positiveDimension(textSourceSize?.width)
    ?? positiveDimension(nestedWidth);
  const sourceHeight =
    positiveDimension(mediaHeight)
    ?? positiveDimension(clip?.source?.videoElement?.videoHeight)
    ?? positiveDimension(clip?.source?.imageElement?.naturalHeight)
    ?? positiveDimension(clip?.source?.nativeDecoder?.height)
    ?? positiveDimension(textSourceSize?.height)
    ?? positiveDimension(nestedHeight);
  const fitToFrameScale = sourceWidth !== null && sourceHeight !== null
    ? calculateFitToFrameScale(
        sourceWidth,
        sourceHeight,
        compWidth,
        compHeight,
      )
    : null;

  const handlePropertyChange = useCallback((property: AnimatableProperty, value: number) => {
    // A node-driven value would be overwritten on the next evaluation; its row is locked and links to the source.
    const current = useTimelineStore.getState().clips.find(item => item.id === clipId);
    if (current && isParameterNodeDriven(current, property)) return;
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

  // The spatial part only: an opacity or blend edit leaves it (and the memoised Transform section) alone.
  const spatialTransform = useMemo(() => ({
    position: transform.position,
    ...(transform.anchor ? { anchor: transform.anchor } : {}),
    scale: transform.scale,
    rotation: transform.rotation,
  }), [transform.anchor, transform.position, transform.rotation, transform.scale]);
  const positionValues = useMemo(() => resolvePositionValues({
    transform: spatialTransform,
    compWidth,
    compHeight,
    isEffectively3D,
    usesCameraControls,
  }), [spatialTransform, compWidth, compHeight, isEffectively3D, usesCameraControls]);
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

  const handlePosXChange = useStableHandler((value: number) => handlePropertyChange(
    'position.x',
    positionValues.usesScenePositionUnits ? value : value / (compWidth / 2),
  ));
  const handlePosYChange = useStableHandler((value: number) => handlePropertyChange(
    'position.y',
    positionValues.usesScenePositionUnits ? value : value / (compHeight / 2),
  ));
  const handlePosZChange = useStableHandler((value: number) => handlePropertyChange(
    'position.z',
    positionValues.usesScenePositionUnits ? value : value / (compWidth / 2),
  ));
  const handleCameraPositionXChange = useCallback((value: number) => handlePropertyChange('position.x', value), [handlePropertyChange]);
  const handleCameraPositionYChange = useCallback((value: number) => handlePropertyChange('position.y', value), [handlePropertyChange]);
  const handleCameraPositionZChange = useCallback((value: number) => handlePropertyChange('position.z', value), [handlePropertyChange]);
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
    handleCameraLookRotationChange: cameraLookRotationChange,
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
  // It closes over the clip and transform; a stable identity keeps the memoised section's props.
  const handleCameraLookRotationChange = useStableHandler(cameraLookRotationChange);

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

  const handleScaleAllChange = useCallback((value: number) => handlePropertyChange('scale.all', value), [handlePropertyChange]);
  const handleScaleXChange = useCallback((value: number) => handlePropertyChange('scale.x', value), [handlePropertyChange]);
  const handleScaleYChange = useCallback((value: number) => handlePropertyChange('scale.y', value), [handlePropertyChange]);
  const handleScaleZChange = useCallback((value: number) => handlePropertyChange('scale.z', value), [handlePropertyChange]);
  const toggleScaleAxis = (property: 'scale.x' | 'scale.y', value: number) => {
    const magnitude = Math.abs(value) || 1;
    handlePropertyChange(property, value < 0 ? magnitude : -magnitude);
  };
  const handleFlipX = useStableHandler(() => toggleScaleAxis('scale.x', transform.scale.x));
  const handleFlipY = useStableHandler(() => toggleScaleAxis('scale.y', transform.scale.y));
  const fitToFrame = useStableHandler(() => {
    if (fitToFrameScale === null) return;
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
  });
  const handleFitToFrame = fitToFrameScale === null ? undefined : fitToFrame;

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
  const handleOpacityChange = useCallback(
    (pct: number) => handlePropertyChange('opacity', Math.max(0, Math.min(100, pct)) / 100),
    [handlePropertyChange],
  );
  const speedPct = speed * 100;
  const handleSpeedChange = useCallback((pct: number) => setClipSpeed(clipId, pct / 100), [clipId, setClipSpeed]);
  const handleFreeRunToggle = useStableHandler(() => updateClip(clipId, { freeRun: !freeRun }));
  const handleToggle3D = useCallback(() => toggle3D(clipId), [clipId, toggle3D]);
  const handleBlendModeChange = useCallback(
    (blendMode: string) => updateClipTransform(clipId, { blendMode: blendMode as BlendMode }),
    [clipId, updateClipTransform],
  );
  const handleLinkedAudioSpeedChange = useCallback(
    (enabled: boolean) => setLinkedClipSpeedEnabled(clipId, enabled),
    [clipId, setLinkedClipSpeedEnabled],
  );
  const handleWireframeToggle = useStableHandler(() => updateClip(clipId, { wireframe: !wireframe }));
  const handleTransformSectionEnabledChange = useCallback(
    (enabled: boolean) => handleInspectorSectionEnabledChange('transform', enabled),
    [handleInspectorSectionEnabledChange],
  );
  const handleThreeDEffectorsToggle = useStableHandler(() => {
    if (!clip?.source) return;
    updateClip(clipId, {
      source: {
        ...clip.source,
        threeDEffectorsEnabled: !threeDEffectorsEnabled,
      },
    });
  });
  const handleModelPrimitiveIndexChange = useStableHandler((index: number | undefined) => {
    if (!clip?.source) return;
    const source = { ...clip.source };
    if (index === undefined) {
      delete source.modelPrimitiveIndex;
    } else {
      source.modelPrimitiveIndex = index;
    }
    updateClip(clipId, { source });
  });

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
          onFreeRunToggle={handleFreeRunToggle}
          onToggle3D={handleToggle3D}
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
          onBlendModeChange={handleBlendModeChange}
          onModelPrimitiveIndexChange={handleModelPrimitiveIndexChange}
          onOpacityChange={handleOpacityChange}
          onSceneNavFpsModeChange={setSceneNavFpsMode}
          onSceneNavFpsMoveSpeedChange={setSceneNavFpsMoveSpeed}
          onSceneNavNoKeyframesChange={setSceneNavNoKeyframes}
          onSceneNavTouchControlsVisibleChange={setSceneNavTouchControlsOverride}
          onSpeedChange={handleSpeedChange}
          onLinkedAudioSpeedChange={handleLinkedAudioSpeedChange}
          onFreeRunToggle={handleFreeRunToggle}
          onThreeDEffectorsToggle={handleThreeDEffectorsToggle}
          onToggle3D={handleToggle3D}
          onWireframeToggle={handleWireframeToggle}
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
      {usesCameraControls && (
        <CameraLensSection
          clipId={clipId}
          settings={cameraSettings}
          onEnabledChange={(physicalCameraEnabled) => {
            const current = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
            if (current?.source?.type === 'camera') {
              updateClip(clipId, { source: { ...current.source, cameraSettings: { ...DEFAULT_SCENE_CAMERA_SETTINGS,
                ...current.source.cameraSettings, physicalCameraEnabled } } });
            }
          }}
          onBatchEnd={handleBatchEnd}
          onBatchStart={handleBatchStart}
          onPropertyChange={handlePropertyChange}
          onToneMappingChange={(toneMapping) => {
            if (clip?.source?.type === 'camera') {
              updateClip(clipId, { source: { ...clip.source, cameraSettings: { ...DEFAULT_SCENE_CAMERA_SETTINGS, ...clip.source.cameraSettings, toneMapping } } });
            }
          }}
        />
      )}

      {usesCameraControls && <CameraShakeSection clipId={clipId} settings={cameraSettings}
        onBatchStart={handleBatchStart} onBatchEnd={handleBatchEnd} onPropertyChange={handlePropertyChange} />}

      <ResolveTransformSection
        clipId={clipId}
        createMidiTarget={createMIDIParameterTarget}
        enabled={isVideoInspectorSectionEnabled(clip?.videoInspectorSections, 'transform')}
        isEffectively3D={isEffectively3D}
        isLocked3D={isLocked3D}
        positionValues={positionValues}
        showLayerDimensionToggle={usesVisualInspectorSections}
        supportsScaleZ={supportsScaleZ}
        transform={spatialTransform}
        usesCameraControls={usesCameraControls}
        onBatchEnd={handleBatchEnd}
        onBatchStart={handleBatchStart}
        onCameraPositionXChange={handleCameraPositionXChange}
        onCameraPositionYChange={handleCameraPositionYChange}
        onCameraPositionZChange={handleCameraPositionZChange}
        onCameraLookRotationChange={handleCameraLookRotationChange}
        onAnchorChange={handlePropertyChange}
        onFitToFrame={handleFitToFrame}
        onFlipX={handleFlipX}
        onFlipY={handleFlipY}
        onEnabledChange={handleTransformSectionEnabledChange}
        onPosXChange={handlePosXChange}
        onPosYChange={handlePosYChange}
        onPosZChange={handlePosZChange}
        onResetProperties={handleResetProperties}
        onRotationChange={handlePropertyChange}
        onScaleAllChange={handleScaleAllChange}
        onScaleXChange={handleScaleXChange}
        onScaleYChange={handleScaleYChange}
        onScaleZChange={handleScaleZChange}
        onToggle3D={handleToggle3D}
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
          onBlendModeChange={handleBlendModeChange}
          onLinkedAudioSpeedChange={handleLinkedAudioSpeedChange}
          onOpacityChange={handleOpacityChange}
          onSectionEnabledChange={handleInspectorSectionEnabledChange}
          onResetComposite={handleResetComposite}
          onResetSpeed={handleResetSpeed}
          onSpeedChange={handleSpeedChange}
        />
      )}
    </div>
  );
});
