import type { Layer, LayerRenderData } from '../../core/types';
import { getGaussianSplatGpuRenderer } from '../../gaussian/core/GaussianSplatGpuRenderer';
import { resolveOrbitCameraFrame } from '../../gaussian/core/SplatCameraUtils';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../gaussian/types';
import { collectScene3DLayers } from '../../scene/SceneLayerCollector';
import { getSharedSceneDefaultCameraDistance, resolveRenderableSharedSceneCamera } from '../../scene/SceneCameraUtils';
import { resolveSceneClipCameraSettings, resolveSceneClipTransform, type SceneTimelineContext } from '../../scene/SceneTimelineUtils';
import type {
  SceneGizmoRenderOptions,
  SceneCameraConfig,
  SceneSplatEffectorRuntimeData,
  SceneSplatLayer,
  SceneVector3,
  SceneViewport,
  SceneWorldTransform,
} from '../../scene/types';
import { Logger } from '../../../services/logger';
import { useEngineStore } from '../../../stores/engineStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import type { RenderDeps } from '../RenderDispatcher';
import type { DispatcherDebugSnapshotFacet, RenderDispatcherDebugSnapshot } from './dispatcherDebugSnapshot';
import type { GaussianSequenceFacet, GaussianSplatSceneLoadRequest } from './gaussianSequenceFacet';

const log = Logger.create('RenderDispatcher');

function degreesToRadians(value: number): number {
  return value * (Math.PI / 180);
}

function buildBasisWorldMatrix(
  position: SceneVector3,
  basis: { right: SceneVector3; up: SceneVector3; forward: SceneVector3 },
): Float32Array {
  return new Float32Array([
    basis.right.x, basis.right.y, basis.right.z, 0,
    basis.up.x, basis.up.y, basis.up.z, 0,
    basis.forward.x, basis.forward.y, basis.forward.z, 0,
    position.x, position.y, position.z, 1,
  ]);
}

function buildCameraGizmoTransform(
  cameraClip: TimelineClip,
  timelineTime: number,
  viewport: SceneViewport,
  context: Pick<SceneTimelineContext, 'clips' | 'clipKeyframes'>,
): Pick<SceneGizmoRenderOptions, 'worldMatrix' | 'worldTransform'> | null {
  if (cameraClip.source?.type !== 'camera') {
    return null;
  }

  const clipLocalTime = timelineTime - cameraClip.startTime;
  const transform = resolveSceneClipTransform(
    cameraClip,
    clipLocalTime,
    timelineTime,
    context,
  );
  const cameraSettings = resolveSceneClipCameraSettings(cameraClip, clipLocalTime, context);
  const frame = resolveOrbitCameraFrame(
    {
      position: transform.position,
      scale: transform.scale,
      rotation: transform.rotation,
    },
    {
      nearPlane: cameraSettings.near,
      farPlane: cameraSettings.far,
      fov: cameraSettings.fov,
      minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
    },
    viewport,
  );
  const worldTransform: SceneWorldTransform = {
    position: frame.eye,
    rotationRadians: {
      x: degreesToRadians(transform.rotation.x),
      y: degreesToRadians(transform.rotation.y),
      z: degreesToRadians(transform.rotation.z),
    },
    rotationDegrees: { ...transform.rotation },
    scale: { x: 1, y: 1, z: 1 },
  };

  return {
    worldMatrix: buildBasisWorldMatrix(frame.eye, {
      right: frame.right,
      up: frame.cameraUp,
      forward: frame.forward,
    }),
    worldTransform,
  };
}

interface SharedScene3DProcessorOptions {
  renderDeps: RenderDeps;
  debugSnapshotFacet: DispatcherDebugSnapshotFacet;
  gaussianSequenceFacet: GaussianSequenceFacet;
  getLastRenderDebugSnapshot: () => RenderDispatcherDebugSnapshot | null;
  getEffectiveTimelineTime: () => number;
  collectActiveSplatEffectors: (width: number, height: number) => SceneSplatEffectorRuntimeData[];
  getNativeGaussianSplatSceneKey: (clipId: string, runtimeKey?: string) => string;
  isSplatLoading: (sceneKey: string) => boolean;
  ensureGaussianSplatSceneLoaded: (request: GaussianSplatSceneLoadRequest) => Promise<boolean>;
}

export class SharedScene3DProcessor {
  private readonly options: SharedScene3DProcessorOptions;
  private sceneRendererInitializing = false;

  constructor(options: SharedScene3DProcessorOptions) {
    this.options = options;
  }

  process3DLayers(
    layerData: LayerRenderData[],
    device: GPUDevice,
    width: number,
    height: number,
    cameraOverride?: SceneCameraConfig | null,
    targetId?: string,
  ): void {
    const indices3D: number[] = [];
    for (let i = 0; i < layerData.length; i++) {
      const source = layerData[i].layer.source;
      if (!layerData[i].layer.is3D || source?.type === 'gaussian-avatar') {
        continue;
      }
      indices3D.push(i);
    }
    if (indices3D.length === 0) return;
    const d = this.options.renderDeps;
    const renderer = d.sceneRenderer;
    const isRealtimePlayback = (d.renderLoop?.getIsPlaying() ?? false)
      && !d.exportCanvasManager.getIsExporting();
    const preciseSplatSorting = d.exportCanvasManager.getIsExporting();

    if (!renderer || !renderer.isInitialized) {
      if (!this.sceneRendererInitializing && !renderer?.isInitialized) {
        this.sceneRendererInitializing = true;
        import('../../native3d/NativeSceneRenderer').then(({ getNativeSceneRenderer }) => {
          const r = getNativeSceneRenderer();
          r.initialize(width, height).then((ok) => {
            if (ok) {
              d.sceneRenderer = r;
              log.info('Shared scene renderer initialized lazily');
            }
            this.sceneRendererInitializing = false;
          });
        });
      }
      for (let i = indices3D.length - 1; i >= 0; i--) {
        layerData.splice(indices3D[i], 1);
      }
      return;
    }
    const includedLayers = new Set(indices3D.map((index) => layerData[index]));
    const layers3D = collectScene3DLayers(layerData, {
      width,
      height,
      preciseVideoSampling: !isRealtimePlayback,
      preciseSplatSorting,
      includeLayer: (data) => includedLayers.has(data),
    });

    const camera = resolveRenderableSharedSceneCamera(
      { width, height },
      this.options.getEffectiveTimelineTime(),
      cameraOverride ? { previewCameraOverride: cameraOverride } : undefined,
    );
    const activeSplatEffectors = this.options.collectActiveSplatEffectors(width, height);
    const renderLayers3D = layers3D.map((layer) => {
      if (layer.kind !== 'splat' || layer.gaussianSplatIsSequence !== true) {
        return layer;
      }
      const previewMaxSplats = preciseSplatSorting ? undefined : this.options.gaussianSequenceFacet.getPreviewMaxSplats(layer);
      if (!previewMaxSplats) {
        return layer;
      }
      return {
        ...layer,
        gaussianSplatRuntimeKey: this.options.gaussianSequenceFacet.getRuntimeKey(
          layer.gaussianSplatRuntimeKey,
          previewMaxSplats,
        ),
        gaussianSplatSettings: {
          ...(layer.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS),
          render: {
            ...(layer.gaussianSplatSettings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render),
            maxSplats: previewMaxSplats,
          },
        },
      };
    });
    const nativeSplatLayers = renderLayers3D.filter((layer): layer is SceneSplatLayer =>
      layer.kind === 'splat',
    );
    const nativeRenderer = getGaussianSplatGpuRenderer();
    const timelineState = useTimelineStore.getState();
    const engineState = useEngineStore.getState();
    const effectivePreviewCameraOverride = cameraOverride === undefined
      ? engineState.previewCameraOverride
      : cameraOverride;
    const isDraggingPlayhead = timelineState.isDraggingPlayhead;
    const primarySelectedClipId = timelineState.primarySelectedClipId && timelineState.selectedClipIds.has(timelineState.primarySelectedClipId)
      ? timelineState.primarySelectedClipId
      : timelineState.selectedClipIds.values().next().value as string | undefined;
    const sceneGizmoVisible = engineState.sceneGizmoVisible !== false;
    const sceneGizmoClipId = sceneGizmoVisible
      ? engineState.sceneGizmoClipIdOverride ?? (
          cameraOverride !== undefined
            ? primarySelectedClipId ?? null
            : effectivePreviewCameraOverride ? null : primarySelectedClipId ?? null
        )
      : null;
    const sceneGizmoClip = sceneGizmoClipId
      ? timelineState.clips.find((clip) => clip.id === sceneGizmoClipId) ?? null
      : null;
    const sceneGizmoCameraTransform = sceneGizmoClip?.source?.type === 'camera'
      ? buildCameraGizmoTransform(
          sceneGizmoClip,
          timelineState.playheadPosition,
          { width, height },
          {
            clips: timelineState.clips,
            clipKeyframes: timelineState.clipKeyframes,
          },
        )
      : null;
    const sceneGizmoHasRenderableLayer = sceneGizmoClipId
      ? renderLayers3D.some((layer) => layer.clipId === sceneGizmoClipId)
      : false;
    const sceneGizmo: SceneGizmoRenderOptions | null = sceneGizmoClipId &&
      timelineState.isExporting !== true &&
      timelineState.isPlaying !== true &&
      (sceneGizmoHasRenderableLayer || sceneGizmoCameraTransform)
      ? {
          clipId: sceneGizmoClipId,
          mode: engineState.sceneGizmoMode,
          hoveredAxis: engineState.sceneGizmoHoveredAxis,
          ...(sceneGizmoCameraTransform ?? {}),
        }
      : null;
    for (const layer of nativeSplatLayers) {
      const previewMaxSplats = preciseSplatSorting ? undefined : this.options.gaussianSequenceFacet.getPreviewMaxSplats(layer);
      const sceneKey = this.options.getNativeGaussianSplatSceneKey(layer.clipId, layer.gaussianSplatRuntimeKey);
      const canHoldSequenceFrame = layer.gaussianSplatIsSequence === true && this.options.gaussianSequenceFacet.hasLastSharedFrame();
      if (!nativeRenderer.hasScene(sceneKey) && !this.options.isSplatLoading(sceneKey)) {
        const canDeferDragLoad =
          layer.gaussianSplatIsSequence === true &&
          isDraggingPlayhead &&
          !isRealtimePlayback &&
          canHoldSequenceFrame;
        if (!canDeferDragLoad) {
          const request = {
            sceneKey,
            clipId: layer.clipId,
            url: layer.gaussianSplatUrl,
            fileName: layer.gaussianSplatFileName ?? layer.layerId,
            file: layer.gaussianSplatFile,
            showProgress: timelineState.isExporting === true || (layer.gaussianSplatIsSequence === true && previewMaxSplats)
              ? false
              : undefined,
            maxSplats: previewMaxSplats,
          };
          if (layer.gaussianSplatIsSequence === true && canHoldSequenceFrame) {
            this.options.gaussianSequenceFacet.scheduleBackgroundLoad(request, true);
          } else {
            void this.options.ensureGaussianSplatSceneLoaded(request);
          }
        }
      }
      if (!preciseSplatSorting) {
        this.options.gaussianSequenceFacet.preloadNearbyFrames(
          layer,
          nativeRenderer,
          isRealtimePlayback,
          isDraggingPlayhead,
          previewMaxSplats,
        );
        this.options.gaussianSequenceFacet.prunePreviewScenes(layer, nativeRenderer, previewMaxSplats);
      }
    }

    const sequenceTargetLayer = nativeSplatLayers.find((layer) => layer.gaussianSplatIsSequence === true);
    const sequenceTargetSceneKey = sequenceTargetLayer
      ? this.options.getNativeGaussianSplatSceneKey(sequenceTargetLayer.clipId, sequenceTargetLayer.gaussianSplatRuntimeKey)
      : undefined;
    const sequenceRenderedSceneKey = sequenceTargetSceneKey && nativeRenderer.hasScene(sequenceTargetSceneKey)
      ? sequenceTargetSceneKey
      : undefined;

    let textureView = renderer.renderScene(
      device,
      renderLayers3D,
      camera,
      activeSplatEffectors,
      isRealtimePlayback,
      sceneGizmo,
      d.maskTextureManager,
      targetId ?? 'main',
    );
    const hasSplatSequence = nativeSplatLayers.some((layer) => layer.gaussianSplatIsSequence === true);
    if (textureView && hasSplatSequence && !targetId) {
      this.options.gaussianSequenceFacet.setLastSharedFrame({
        textureView,
        sceneKey: sequenceRenderedSceneKey ?? sequenceTargetSceneKey ?? '',
        width,
        height,
      });
    }
    if (!textureView) {
      const lastSharedSplatSequenceFrame = this.options.gaussianSequenceFacet.getLastSharedFrame();
      const canHoldLastSplatSequenceFrame =
        !targetId &&
        hasSplatSequence &&
        lastSharedSplatSequenceFrame !== null &&
        lastSharedSplatSequenceFrame.width === width &&
        lastSharedSplatSequenceFrame.height === height;
      if (canHoldLastSplatSequenceFrame) {
        textureView = lastSharedSplatSequenceFrame!.textureView;
        this.options.debugSnapshotFacet.setSplatSequenceDebugSnapshot(this.options.getLastRenderDebugSnapshot(), {
          targetSceneKey: sequenceTargetSceneKey,
          renderedSceneKey: lastSharedSplatSequenceFrame!.sceneKey || undefined,
          mode: 'held',
          visualFrameChangesLastSecond: this.options.gaussianSequenceFacet.recordVisualFrame(
            lastSharedSplatSequenceFrame!.sceneKey || undefined,
            false,
          ),
          backgroundLoads: this.options.gaussianSequenceFacet.getBackgroundLoadCount(),
        });
      } else {
        if (!hasSplatSequence) {
          this.options.gaussianSequenceFacet.clearLastSharedFrame();
        }
        if (hasSplatSequence) {
          this.options.debugSnapshotFacet.setSplatSequenceDebugSnapshot(this.options.getLastRenderDebugSnapshot(), {
            targetSceneKey: sequenceTargetSceneKey,
            renderedSceneKey: undefined,
            mode: 'missing',
            visualFrameChangesLastSecond: this.options.gaussianSequenceFacet.recordVisualFrame(undefined, false),
            backgroundLoads: this.options.gaussianSequenceFacet.getBackgroundLoadCount(),
          });
        }
        for (let i = indices3D.length - 1; i >= 0; i--) {
          layerData.splice(indices3D[i], 1);
        }
        return;
      }
    } else if (hasSplatSequence) {
      this.options.debugSnapshotFacet.setSplatSequenceDebugSnapshot(this.options.getLastRenderDebugSnapshot(), {
        targetSceneKey: sequenceTargetSceneKey,
        renderedSceneKey: sequenceRenderedSceneKey,
        mode: 'target',
        visualFrameChangesLastSecond: this.options.gaussianSequenceFacet.recordVisualFrame(sequenceRenderedSceneKey, true),
        backgroundLoads: this.options.gaussianSequenceFacet.getBackgroundLoadCount(),
      });
    }

    if (!textureView) {
      for (let i = indices3D.length - 1; i >= 0; i--) {
        layerData.splice(indices3D[i], 1);
      }
      return;
    }

    const insertIdx = indices3D[0];
    const firstLayer = layerData[indices3D[0]].layer;
    const isSingle3D = indices3D.length === 1;
    const syntheticLayer: Layer = {
      id: '__scene_3d__',
      name: '3D Scene',
      visible: true,
      opacity: isSingle3D ? firstLayer.opacity : 1,
      blendMode: isSingle3D ? firstLayer.blendMode : 'normal',
      source: { type: 'image' },
      effects: isSingle3D ? firstLayer.effects : [],
      colorCorrection: isSingle3D ? firstLayer.colorCorrection : undefined,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    const syntheticData: LayerRenderData = {
      layer: syntheticLayer,
      isVideo: false,
      externalTexture: null,
      textureView,
      sourceWidth: width,
      sourceHeight: height,
    };

    for (let i = indices3D.length - 1; i >= 0; i--) {
      layerData.splice(indices3D[i], 1);
    }
    layerData.splice(insertIdx, 0, syntheticData);
  }
}
