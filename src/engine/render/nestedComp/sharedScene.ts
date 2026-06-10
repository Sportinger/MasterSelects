import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { Layer, LayerRenderData } from '../../core/types';
import { getNativeSceneRenderer } from '../../native3d/NativeSceneRenderer';
import { resolveRenderableSharedSceneCamera } from '../../scene/SceneCameraUtils';
import { collectActiveSceneSplatEffectors } from '../../scene/SceneEffectorUtils';
import { collectScene3DLayers } from '../../scene/SceneLayerCollector';
import type { MaskTextureManager } from '../../texture/MaskTextureManager';
import { useTimelineStore } from '../../../stores/timeline';

interface NestedCompSceneLogger {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
}

interface Process3DLayersForNestedParams {
  layerData: LayerRenderData[];
  device: GPUDevice;
  maskTextureManager: MaskTextureManager;
  log: NestedCompSceneLogger;
  width: number;
  height: number;
  currentTime?: number;
  compositionId?: string;
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
}

export function process3DLayersForNestedScene(params: Process3DLayersForNestedParams): void {
  const {
    layerData,
    device,
    maskTextureManager,
    log,
    width,
    height,
    currentTime,
    compositionId,
    sceneClips,
    sceneTracks,
  } = params;

  const indices3D: number[] = [];
  for (let i = 0; i < layerData.length; i++) {
    if (layerData[i].layer.is3D && layerData[i].layer.source?.type !== 'gaussian-avatar') {
      indices3D.push(i);
    }
  }
  if (indices3D.length === 0) {
    if (layerData.length > 0) {
      log.debug('No 3D layers in nested comp', {
        totalLayers: layerData.length,
        sourceTypes: layerData.map(d => d.layer.source?.type),
        is3Ds: layerData.map(d => d.layer.is3D),
      });
    }
    return;
  }
  log.debug('Processing 3D layers in nested comp', { count: indices3D.length });

  const renderer = getNativeSceneRenderer();
  if (!renderer.isInitialized) {
    renderer.initialize(width, height).then((ok) => {
      if (ok) log.info('Shared scene renderer initialized from nested comp');
    });
    for (let i = indices3D.length - 1; i >= 0; i--) layerData.splice(indices3D[i], 1);
    return;
  }

  const timelineStore = useTimelineStore.getState();
  const preciseSplatSorting = timelineStore.isExporting === true;
  const isRealtimePlayback = timelineStore.isPlaying && timelineStore.isExporting !== true;
  const includedLayers = new Set(indices3D.map((index) => layerData[index]));
  const layers3D = collectScene3DLayers(layerData, {
    width,
    height,
    preciseVideoSampling: !isRealtimePlayback,
    preciseSplatSorting,
    includeLayer: (data) => includedLayers.has(data),
  });
  const sceneContext = sceneClips && sceneTracks
    ? {
        clips: sceneClips,
        tracks: sceneTracks,
        clipKeyframes: timelineStore.clipKeyframes,
        compositionId,
        sceneNavClipId: null,
      }
    : (compositionId ? { compositionId } : undefined);
  const activeSplatEffectors = sceneClips && sceneTracks
    ? collectActiveSceneSplatEffectors(
        width,
        height,
        currentTime ?? 0,
        {
          clips: sceneClips,
          tracks: sceneTracks,
          clipKeyframes: timelineStore.clipKeyframes,
          compositionId,
          sceneNavClipId: null,
        },
      )
    : [];

  const textureView = renderer.renderScene(
    device,
    layers3D,
    resolveRenderableSharedSceneCamera({ width, height }, currentTime ?? 0, sceneContext),
    activeSplatEffectors,
    isRealtimePlayback,
    null,
    maskTextureManager,
  );
  if (!textureView) {
    for (let i = indices3D.length - 1; i >= 0; i--) layerData.splice(indices3D[i], 1);
    return;
  }

  const insertIdx = indices3D[0];
  const firstLayer = layerData[indices3D[0]].layer;
  const isSingle = indices3D.length === 1;
  const syntheticLayer: Layer = {
    id: '__scene_3d_nested__',
    name: '3D Scene (Nested)',
    visible: true,
    opacity: isSingle ? firstLayer.opacity : 1,
    blendMode: isSingle ? firstLayer.blendMode : 'normal',
    source: { type: 'image' },
    effects: isSingle ? firstLayer.effects : [],
    colorCorrection: isSingle ? firstLayer.colorCorrection : undefined,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };

  for (let i = indices3D.length - 1; i >= 0; i--) layerData.splice(indices3D[i], 1);
  layerData.splice(insertIdx, 0, {
    layer: syntheticLayer,
    isVideo: false,
    externalTexture: null,
    textureView,
    sourceWidth: width,
    sourceHeight: height,
  });
}
