import { Logger } from '../../services/logger';
import { getGaussianSplatGpuRenderer } from '../gaussian/core/GaussianSplatGpuRenderer';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';
import { resolveSharedSplatSceneKey } from '../scene/runtime/SharedSplatRuntimeUtils';
import type {
  SceneCamera,
  SceneFaceCableLayer,
  SceneFlockLayer,
  SceneGizmoRenderOptions,
  SceneLayer3DData,
  SceneLightLayer,
  ScenePlaneLayer,
  SceneSplatEffectorRuntimeData,
  SceneSplatLayer,
  SceneVoxelLayer,
} from '../scene/types';
import type { ModelSequenceData } from '../../types';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import { ModelRuntimeCache } from './assets/ModelRuntimeCache';
import { EffectorCompute } from './passes/EffectorCompute';
import { FlockPass } from './passes/FlockPass';
import { GizmoPass } from './passes/GizmoPass';
import { MeshPass, type SceneNativeMeshLayer } from './passes/MeshPass';
import { PlanePass } from './passes/PlanePass';
import { FaceCablePass } from './passes/FaceCablePass';
import { SplatPass } from './passes/SplatPass';
import { VoxelPass } from './passes/VoxelPass';
import {
  SCENE_COLOR_FORMAT,
  SCENE_DEPTH_FORMAT,
  SPLAT_SOFT_DEPTH_ALPHA_CUTOFF,
} from './sceneRenderer/constants';
import {
  canRenderNativeScene,
  sortBySceneLayerDepth,
  splitMeshLayers,
  splitPlaneLayers,
} from './sceneRenderer/drawPlan';
import {
  collectRetainedModelUrls,
  getModelSequencePreloadOptions,
  prepareModelLayerForRender,
} from './sceneRenderer/modelSequence';
import { createCompositeResources } from './sceneRenderer/pipelineResources';
import { createSceneTargets, hasMatchingSceneTargets, type SceneTargets } from './sceneRenderer/targets';
import {
  LayerSpaceEffectRenderer,
  type LayerSpaceEffectContext,
} from './sceneRenderer/LayerSpaceEffectRenderer';

const log = Logger.create('NativeSceneRenderer');

export class NativeSceneRenderer {
  private initialized = false;
  private sceneTexture: GPUTexture | null = null;
  private sceneView: GPUTextureView | null = null;
  private sceneGizmoTexture: GPUTexture | null = null;
  private sceneGizmoView: GPUTextureView | null = null;
  private sceneDepthTexture: GPUTexture | null = null;
  private sceneDepthView: GPUTextureView | null = null;
  private readonly sceneTargets = new Map<string, SceneTargets>();
  private compositePipeline: GPURenderPipeline | null = null;
  private compositeBindGroupLayout: GPUBindGroupLayout | null = null;
  private compositeSampler: GPUSampler | null = null;
  private readonly planePass = new PlanePass();
  private readonly faceCablePass = new FaceCablePass();
  private readonly meshPass = new MeshPass();
  private readonly gizmoPass = new GizmoPass();
  private readonly splatPass = new SplatPass();
  private readonly voxelPass = new VoxelPass();
  private readonly flockPass = new FlockPass();
  private readonly effectorCompute = new EffectorCompute();
  private readonly modelRuntimeCache = new ModelRuntimeCache();
  private readonly lastRenderableModelSequenceUrls = new Map<string, string>();
  private readonly layerSpaceEffectRenderer = new LayerSpaceEffectRenderer();

  private getSplatSceneKey(layer: SceneSplatLayer): string {
    return resolveSharedSplatSceneKey({
      clipId: layer.clipId,
      runtimeKey: layer.gaussianSplatRuntimeKey,
    });
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(_width: number, _height: number): Promise<boolean> {
    this.initialized = true;
    return true;
  }

  async preloadModel(url: string, fileName: string, modelSequence?: ModelSequenceData): Promise<boolean> {
    if (!url) {
      return false;
    }

    this.modelRuntimeCache.touch(url, fileName);
    return this.modelRuntimeCache.preload(url, fileName, getModelSequencePreloadOptions(modelSequence));
  }

  pruneSceneTargets(activeTargetKeys: ReadonlySet<string>): void {
    for (const [key, targets] of this.sceneTargets) {
      if (activeTargetKeys.has(key)) continue;
      targets.texture.destroy();
      targets.gizmoTexture?.destroy();
      targets.depthTexture.destroy();
      this.sceneTargets.delete(key);
      this.layerSpaceEffectRenderer.releaseTarget(key);
      this.faceCablePass.releaseTarget(key);
    }
  }

  releaseSceneTarget(targetKey: string): void {
    const targets = this.sceneTargets.get(targetKey);
    if (!targets) return;
    targets.texture.destroy();
    targets.gizmoTexture?.destroy();
    targets.depthTexture.destroy();
    this.sceneTargets.delete(targetKey);
    this.layerSpaceEffectRenderer.releaseTarget(targetKey);
    this.faceCablePass.releaseTarget(targetKey);
  }

  getGizmoOverlayView(targetKey: string = 'main'): GPUTextureView | null {
    return this.sceneTargets.get(targetKey)?.gizmoView ?? null;
  }

  renderScene(
    device: GPUDevice,
    layers: SceneLayer3DData[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
    maskTextureManager?: MaskTextureManager | null,
    targetKey: string = 'main',
    layerSpaceEffects?: LayerSpaceEffectContext,
  ): GPUTextureView | null {
    if (!this.initialized) {
      return null;
    }

    const planeLayers = this.planePass.collect(layers);
    const meshLayers = this.meshPass.collect(layers);
    const splatLayers = this.splatPass.collect(layers);
    const voxelLayers = this.voxelPass.collect(layers);
    const flockLayers = this.flockPass.collect(layers);
    const lightLayers = layers.filter((layer): layer is SceneLightLayer => layer.kind === 'light');
    const preparedMeshLayers = meshLayers.map((layer) =>
      layer.kind === 'model'
        ? prepareModelLayerForRender(
            layer,
            realtimePlayback,
            this.modelRuntimeCache,
            this.lastRenderableModelSequenceUrls,
          )
        : layer,
    );
    const nativeMeshLayers = this.meshPass.collectNativeLayers(preparedMeshLayers);

    if (!canRenderNativeScene(layers, planeLayers, nativeMeshLayers, splatLayers, lightLayers)) {
      return null;
    }

    const nativeSceneView = this.renderNativeScene(
      device,
      planeLayers,
      voxelLayers,
      flockLayers,
      nativeMeshLayers,
      splatLayers,
      lightLayers,
      layers.filter((layer): layer is SceneFaceCableLayer => layer.kind === 'face-cables'),
      camera,
      effectors,
      realtimePlayback,
      gizmo,
      maskTextureManager,
      targetKey,
      layerSpaceEffects,
    );
    if (!nativeSceneView) {
      return null;
    }

    log.debug('Rendered native shared scene frame', {
      totalLayers: layers.length,
      planes: planeLayers.length,
      meshes: meshLayers.length,
      splats: splatLayers.length,
      voxels: voxelLayers.length,
      flocks: flockLayers.length,
      lights: lightLayers.length,
    });
    return nativeSceneView;
  }

  dispose(): void {
    for (const targets of this.sceneTargets.values()) {
      targets.texture.destroy();
      targets.gizmoTexture?.destroy();
      targets.depthTexture.destroy();
    }
    this.sceneTargets.clear();
    this.sceneTexture = null;
    this.sceneView = null;
    this.sceneGizmoTexture = null;
    this.sceneGizmoView = null;
    this.sceneDepthTexture = null;
    this.sceneDepthView = null;
    this.compositePipeline = null;
    this.compositeBindGroupLayout = null;
    this.compositeSampler = null;
    this.initialized = false;
    this.planePass.dispose();
    this.faceCablePass.dispose();
    this.meshPass.dispose();
    this.voxelPass.dispose();
    this.gizmoPass.dispose();
    this.layerSpaceEffectRenderer.destroy();
    this.modelRuntimeCache.clear();
  }

  private ensureSceneTargets(device: GPUDevice, targetKey: string, width: number, height: number): void {
    let targets = this.sceneTargets.get(targetKey);
    if (!targets || !hasMatchingSceneTargets(targets, width, height)) {
      targets?.texture.destroy();
      targets?.gizmoTexture?.destroy();
      targets?.depthTexture.destroy();
      targets = createSceneTargets(device, width, height);
      this.sceneTargets.set(targetKey, targets);
    }
    this.sceneTexture = targets.texture;
    this.sceneView = targets.view;
    this.sceneGizmoTexture = targets.gizmoTexture;
    this.sceneGizmoView = targets.gizmoView;
    this.sceneDepthTexture = targets.depthTexture;
    this.sceneDepthView = targets.depthView;
  }

  private renderNativeScene(
    device: GPUDevice,
    planeLayers: ScenePlaneLayer[],
    voxelLayers: SceneVoxelLayer[],
    flockLayers: SceneFlockLayer[],
    nativeMeshLayers: SceneNativeMeshLayer[],
    layers: SceneSplatLayer[],
    lightLayers: SceneLightLayer[],
    cableLayers: SceneFaceCableLayer[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
    maskTextureManager?: MaskTextureManager | null,
    targetKey: string = 'main',
    layerSpaceEffects?: LayerSpaceEffectContext,
  ): GPUTextureView | null {
    const renderer = getGaussianSplatGpuRenderer();
    if (layers.length > 0 && !renderer.isInitialized) {
      renderer.initialize(device);
    }

    if (layers.length > 0 && !layers.every((layer) => renderer.hasScene(this.getSplatSceneKey(layer)))) {
      return null;
    }

    this.ensureSceneTargets(device, targetKey, camera.viewport.width, camera.viewport.height);
    this.ensureCompositeResources(device);
    this.planePass.ensureResources(device);
    this.meshPass.initialize(device, SCENE_DEPTH_FORMAT);
    this.voxelPass.initialize(device);
    this.gizmoPass.initialize(device, SCENE_COLOR_FORMAT);
    if (
      !this.sceneTexture ||
      !this.sceneView ||
      !this.sceneGizmoTexture ||
      !this.sceneGizmoView ||
      !this.sceneDepthTexture ||
      !this.sceneDepthView ||
      !this.compositePipeline ||
      !this.compositeBindGroupLayout ||
      !this.compositeSampler ||
      !this.planePass.isReady
    ) {
      return null;
    }

    const commandEncoder = device.createCommandEncoder();
    if (layers.length > 0) {
      renderer.beginFrame();
    }
    const sortedLayers = sortBySceneLayerDepth(layers, camera);
    const temporaryBuffers: GPUBuffer[] = [];
    const { opaqueMeshes, transparentMeshes } = splitMeshLayers(
      nativeMeshLayers,
      camera,
      (layer) => this.meshPass.isTransparent(layer, this.modelRuntimeCache),
    );
    const activeModelUrls = collectRetainedModelUrls(
      nativeMeshLayers,
      this.lastRenderableModelSequenceUrls,
    );
    const { opaquePlanes, transparentPlanes } = splitPlaneLayers(planeLayers, camera);
    this.planePass.pruneTextureCache(new Set([...planeLayers, ...voxelLayers, ...cableLayers].map((layer) => layer.layerId)));
    const effectedTextureViews = layerSpaceEffects
      ? this.layerSpaceEffectRenderer.prepare({
          ...layerSpaceEffects,
          device,
          commandEncoder,
          layers: [...planeLayers, ...voxelLayers, ...cableLayers.map(layer => ({ ...layer, kind: 'plane' as const }))],
          targetKey,
          resolveSource: (layer) => {
            const view = this.planePass.resolveTextureView(device, layer);
            const cached = this.planePass.getCachedTexture(layer.layerId);
            return view && cached ? { view, width: cached.width, height: cached.height } : null;
          },
        })
      : new Map<string, GPUTextureView>();
    this.meshPass.pruneModelCache(activeModelUrls);
    // Flock simulations advance (compute) before any scene render pass is opened.
    const flockPlans = this.flockPass.prepare(device, commandEncoder, flockLayers, realtimePlayback);

    // Shared native scene pass graph, phase 1:
    //   1. Opaque depth-writing geometry -> scene color + shared depth
    //   2. Splats -> scene color, depth-tested but no writes for full gaussian blending quality
    //   3. Splats -> shared soft depth mask, writing only high-alpha cores for cross-splat occlusion
    //   4. Transparent planes/materials and blended flock branches -> scene color after splats
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.sceneView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.sceneDepthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
      label: 'native-scene-clear-pass',
    });
    clearPass.end();

    if (!this.meshPass.renderPrimitivePass(
      device,
      commandEncoder,
      this.sceneView,
      this.sceneDepthView,
      opaqueMeshes,
      camera,
      effectors,
      lightLayers,
      this.modelRuntimeCache,
      temporaryBuffers,
      false,
    )) {
      return null;
    }

    if (!this.planePass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, opaquePlanes, camera, false, temporaryBuffers, maskTextureManager, effectedTextureViews)) {
      return null;
    }
    if (!this.faceCablePass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, cableLayers, lightLayers, camera, targetKey,
      layer => effectedTextureViews.get(layer.layerId) ?? this.planePass.resolveTextureView(device, layer), temporaryBuffers)) return null;

    const readyVoxels = voxelLayers.flatMap((layer) => {
      const textureView = effectedTextureViews.get(layer.layerId) ?? this.planePass.resolveTextureView(device, layer);
      return textureView ? [{ layer, textureView }] : [];
    });
    if (!this.voxelPass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, readyVoxels, camera, temporaryBuffers)) return null;
    if (!this.flockPass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, flockPlans, camera, 'opaque', temporaryBuffers)) return null;

    for (const layer of sortedLayers) {
      const renderSettings = layer.gaussianSplatSettings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
      const sceneKey = this.getSplatSceneKey(layer);
      const layerEffectors = this.effectorCompute.resolveEffectorsForLayer(layer, effectors);
      const textureView = renderer.renderToTexture(
        sceneKey,
        camera,
        camera.viewport,
        commandEncoder,
        {
          clipLocalTime: layer.mediaTime,
          backgroundColor: 'transparent',
          outputView: this.sceneView,
          colorLoadOp: 'load',
          depthView: this.sceneDepthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
          depthWrite: false,
          layerOpacity: layer.opacity,
          splatScale: renderSettings.splatScale,
          nearPlane: renderSettings.nearPlane,
          farPlane: renderSettings.farPlane,
          depthAlphaCutoff: 0,
          effectors: layerEffectors,
          worldMatrix: layer.worldMatrix,
          maxSplats: renderSettings.maxSplats,
          particleSettings: layer.gaussianSplatSettings?.particle,
          // Paused preview uses the same worker depth-order cadence as playback.
          // The GPU "precise" path remains reserved for export.
          precise: layer.preciseSplatSorting === true,
          sortFrequency: layer.preciseSplatSorting === true ? 1 : renderSettings.sortFrequency,
          temporalSettings: layer.gaussianSplatSettings?.temporal,
        },
      );

      if (!textureView) {
        return null;
      }

      const depthMaskView = renderer.renderToTexture(
        sceneKey,
        camera,
        camera.viewport,
        commandEncoder,
        {
          clipLocalTime: layer.mediaTime,
          backgroundColor: 'transparent',
          outputView: this.sceneView,
          colorLoadOp: 'load',
          depthView: this.sceneDepthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
          depthWrite: true,
          colorWrite: false,
          layerOpacity: layer.opacity,
          splatScale: renderSettings.splatScale,
          nearPlane: renderSettings.nearPlane,
          farPlane: renderSettings.farPlane,
          depthAlphaCutoff: SPLAT_SOFT_DEPTH_ALPHA_CUTOFF,
          effectors: layerEffectors,
          worldMatrix: layer.worldMatrix,
          maxSplats: renderSettings.maxSplats,
          particleSettings: layer.gaussianSplatSettings?.particle,
          precise: false,
          sortFrequency: 0,
          temporalSettings: layer.gaussianSplatSettings?.temporal,
        },
      );

      if (!depthMaskView) {
        return null;
      }
    }

    if (!this.meshPass.renderPrimitivePass(
      device,
      commandEncoder,
      this.sceneView,
      this.sceneDepthView,
      transparentMeshes,
      camera,
      effectors,
      lightLayers,
      this.modelRuntimeCache,
      temporaryBuffers,
      true,
    )) {
      return null;
    }

    if (!this.planePass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, transparentPlanes, camera, true, temporaryBuffers, maskTextureManager, effectedTextureViews)) {
      return null;
    }
    if (!this.flockPass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, flockPlans, camera, 'transparent', temporaryBuffers)) return null;
    const gizmoLayer = gizmo
      ? [...planeLayers, ...voxelLayers, ...flockLayers, ...nativeMeshLayers, ...layers, ...lightLayers].find((layer) => layer.clipId === gizmo.clipId) ??
        (gizmo.worldMatrix && gizmo.worldTransform
          ? {
              clipId: gizmo.clipId,
              worldMatrix: gizmo.worldMatrix,
              worldTransform: gizmo.worldTransform,
            }
          : null)
      : null;
    if (gizmo && !this.gizmoPass.render(
      device,
      commandEncoder,
      this.sceneGizmoView,
      gizmoLayer,
      camera,
      gizmo.mode,
      gizmo.hoveredAxis,
      temporaryBuffers,
      true,
    )) {
      return null;
    }
    device.queue.submit([commandEncoder.finish()]);
    void device.queue.onSubmittedWorkDone()
      .then(() => {
        for (const buffer of temporaryBuffers) {
          buffer.destroy();
        }
      })
      .catch(() => {
        for (const buffer of temporaryBuffers) {
          buffer.destroy();
        }
      });
    return this.sceneView;
  }

  private ensureCompositeResources(device: GPUDevice): void {
    if (this.compositePipeline && this.compositeBindGroupLayout && this.compositeSampler) {
      return;
    }

    const resources = createCompositeResources(device);
    this.compositePipeline = resources.pipeline;
    this.compositeBindGroupLayout = resources.bindGroupLayout;
    this.compositeSampler = resources.sampler;
  }
}

let instance: NativeSceneRenderer | null = import.meta.hot?.data?.nativeSceneRenderer ?? null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (instance) Object.setPrototypeOf(instance, NativeSceneRenderer.prototype);
  import.meta.hot.dispose((data) => {
    data.nativeSceneRenderer = instance;
  });
}

export function getNativeSceneRenderer(): NativeSceneRenderer {
  if (!instance) {
    instance = new NativeSceneRenderer();
  }
  return instance;
}
