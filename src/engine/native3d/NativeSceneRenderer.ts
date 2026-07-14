import { Logger } from '../../services/logger';
import { getGaussianSplatGpuRenderer } from '../gaussian/core/GaussianSplatGpuRenderer';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';
import { resolveSharedSplatSceneKey } from '../scene/runtime/SharedSplatRuntimeUtils';
import type {
  SceneCamera,
  SceneGizmoRenderOptions,
  SceneLayer3DData,
  SceneLightLayer,
  ScenePlaneLayer,
  SceneSplatEffectorRuntimeData,
  SceneSplatLayer,
} from '../scene/types';
import type { ModelSequenceData } from '../../types';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import { ModelRuntimeCache } from './assets/ModelRuntimeCache';
import { EffectorCompute } from './passes/EffectorCompute';
import { GizmoPass } from './passes/GizmoPass';
import { MeshPass, type SceneNativeMeshLayer } from './passes/MeshPass';
import { PlanePass } from './passes/PlanePass';
import { SplatPass } from './passes/SplatPass';
import {
  PLANE_UNIFORM_SIZE,
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
import {
  createCompositeResources,
  createPlaneResources,
  createPlaneWhiteMaskResource,
} from './sceneRenderer/pipelineResources';
import { buildPlaneMvp, buildPlaneUniformData } from './sceneRenderer/planeUniforms';
import { resolvePlaneTextureSource, type CachedPlaneTexture } from './sceneRenderer/planeTextureSources';
import { createSceneTargets, hasMatchingSceneTargets } from './sceneRenderer/targets';

const log = Logger.create('NativeSceneRenderer');

export class NativeSceneRenderer {
  private initialized = false;
  private sceneTexture: GPUTexture | null = null;
  private sceneView: GPUTextureView | null = null;
  private sceneDepthTexture: GPUTexture | null = null;
  private sceneDepthView: GPUTextureView | null = null;
  private compositePipeline: GPURenderPipeline | null = null;
  private compositeBindGroupLayout: GPUBindGroupLayout | null = null;
  private compositeSampler: GPUSampler | null = null;
  private planePipelineOpaque: GPURenderPipeline | null = null;
  private planePipelineTransparent: GPURenderPipeline | null = null;
  private planeBindGroupLayout: GPUBindGroupLayout | null = null;
  private planeSampler: GPUSampler | null = null;
  private planeWhiteMaskTexture: GPUTexture | null = null;
  private planeWhiteMaskView: GPUTextureView | null = null;
  private planeTextures = new Map<string, CachedPlaneTexture>();
  private readonly planePass = new PlanePass();
  private readonly meshPass = new MeshPass();
  private readonly gizmoPass = new GizmoPass();
  private readonly splatPass = new SplatPass();
  private readonly effectorCompute = new EffectorCompute();
  private readonly modelRuntimeCache = new ModelRuntimeCache();
  private readonly lastRenderableModelSequenceUrls = new Map<string, string>();

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

  renderScene(
    device: GPUDevice,
    layers: SceneLayer3DData[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
    maskTextureManager?: MaskTextureManager | null,
  ): GPUTextureView | null {
    if (!this.initialized) {
      return null;
    }

    const planeLayers = this.planePass.collect(layers);
    const meshLayers = this.meshPass.collect(layers);
    const splatLayers = this.splatPass.collect(layers);
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
      nativeMeshLayers,
      splatLayers,
      lightLayers,
      camera,
      effectors,
      realtimePlayback,
      gizmo,
      maskTextureManager,
    );
    if (!nativeSceneView) {
      return null;
    }

    log.debug('Rendered native shared scene frame', {
      totalLayers: layers.length,
      planes: planeLayers.length,
      meshes: meshLayers.length,
      splats: splatLayers.length,
      lights: lightLayers.length,
    });
    return nativeSceneView;
  }

  dispose(): void {
    this.sceneTexture?.destroy();
    this.sceneTexture = null;
    this.sceneView = null;
    this.sceneDepthTexture?.destroy();
    this.sceneDepthTexture = null;
    this.sceneDepthView = null;
    this.compositePipeline = null;
    this.compositeBindGroupLayout = null;
    this.compositeSampler = null;
    this.planePipelineOpaque = null;
    this.planePipelineTransparent = null;
    this.planeBindGroupLayout = null;
    this.planeSampler = null;
    this.planeWhiteMaskTexture?.destroy();
    this.planeWhiteMaskTexture = null;
    this.planeWhiteMaskView = null;
    this.initialized = false;
    this.meshPass.dispose();
    this.gizmoPass.dispose();
    for (const entry of this.planeTextures.values()) {
      entry.texture.destroy();
    }
    this.planeTextures.clear();
    this.modelRuntimeCache.clear();
  }

  private ensureSceneTargets(device: GPUDevice, width: number, height: number): void {
    if (hasMatchingSceneTargets({
      texture: this.sceneTexture,
      view: this.sceneView,
      depthTexture: this.sceneDepthTexture,
      depthView: this.sceneDepthView,
    }, width, height)) {
      return;
    }

    this.sceneTexture?.destroy();
    this.sceneDepthTexture?.destroy();
    const targets = createSceneTargets(device, width, height);
    this.sceneTexture = targets.texture;
    this.sceneView = targets.view;
    this.sceneDepthTexture = targets.depthTexture;
    this.sceneDepthView = targets.depthView;
  }

  private renderNativeScene(
    device: GPUDevice,
    planeLayers: ScenePlaneLayer[],
    nativeMeshLayers: SceneNativeMeshLayer[],
    layers: SceneSplatLayer[],
    lightLayers: SceneLightLayer[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
    maskTextureManager?: MaskTextureManager | null,
  ): GPUTextureView | null {
    const renderer = getGaussianSplatGpuRenderer();
    if (layers.length > 0 && !renderer.isInitialized) {
      renderer.initialize(device);
    }

    if (layers.length > 0 && !layers.every((layer) => renderer.hasScene(this.getSplatSceneKey(layer)))) {
      return null;
    }

    this.ensureSceneTargets(device, camera.viewport.width, camera.viewport.height);
    this.ensureCompositeResources(device);
    this.ensurePlaneResources(device);
    this.meshPass.initialize(device, SCENE_DEPTH_FORMAT);
    this.gizmoPass.initialize(device, SCENE_COLOR_FORMAT);
    if (
      !this.sceneTexture ||
      !this.sceneView ||
      !this.sceneDepthTexture ||
      !this.sceneDepthView ||
      !this.compositePipeline ||
      !this.compositeBindGroupLayout ||
      !this.compositeSampler ||
      !this.planePipelineOpaque ||
      !this.planePipelineTransparent ||
      !this.planeBindGroupLayout ||
      !this.planeSampler
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
    this.prunePlaneTextureCache(new Set(planeLayers.map((layer) => layer.layerId)));
    this.meshPass.pruneModelCache(activeModelUrls);

    // Shared native scene pass graph, phase 1:
    //   1. Opaque depth-writing geometry -> scene color + shared depth
    //   2. Splats -> scene color, depth-tested but no writes for full gaussian blending quality
    //   3. Splats -> shared soft depth mask, writing only high-alpha cores for cross-splat occlusion
    //   4. Transparent planes/materials -> scene color after splats
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

    if (!this.renderPlanePass(device, commandEncoder, opaquePlanes, camera, false, temporaryBuffers, maskTextureManager)) {
      return null;
    }

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
          depthAlphaCutoff: 0,
          effectors: layerEffectors,
          worldMatrix: layer.worldMatrix,
          maxSplats: renderSettings.maxSplats,
          particleSettings: layer.gaussianSplatSettings?.particle,
          // Paused preview must use the same worker depth order as playback.
          // The GPU "precise" sort path is reserved for export/explicit precise
          // rendering; using it for pause caused a different visual result.
          precise: layer.preciseSplatSorting === true,
          sortFrequency: realtimePlayback && layer.preciseSplatSorting !== true
            ? renderSettings.sortFrequency
            : 1,
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

    if (!this.renderPlanePass(device, commandEncoder, transparentPlanes, camera, true, temporaryBuffers, maskTextureManager)) {
      return null;
    }
    const gizmoLayer = gizmo
      ? [...planeLayers, ...nativeMeshLayers, ...layers, ...lightLayers].find((layer) => layer.clipId === gizmo.clipId) ??
        (gizmo.worldMatrix && gizmo.worldTransform
          ? {
              clipId: gizmo.clipId,
              worldMatrix: gizmo.worldMatrix,
              worldTransform: gizmo.worldTransform,
            }
          : null)
      : null;
    if (gizmoLayer && !this.gizmoPass.render(
      device,
      commandEncoder,
      this.sceneView,
      gizmoLayer,
      camera,
      gizmo!.mode,
      gizmo!.hoveredAxis,
      temporaryBuffers,
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

  private ensurePlaneResources(device: GPUDevice): void {
    if (
      this.planePipelineOpaque &&
      this.planePipelineTransparent &&
      this.planeBindGroupLayout &&
      this.planeSampler &&
      this.planeWhiteMaskView
    ) {
      return;
    }

    const resources = createPlaneResources(device);
    this.planePipelineOpaque = resources.opaquePipeline;
    this.planePipelineTransparent = resources.transparentPipeline;
    this.planeBindGroupLayout = resources.bindGroupLayout;
    this.planeSampler = resources.sampler;
    this.planeWhiteMaskTexture?.destroy();
    const whiteMask = createPlaneWhiteMaskResource(device);
    this.planeWhiteMaskTexture = whiteMask.whiteMaskTexture;
    this.planeWhiteMaskView = whiteMask.whiteMaskView;
  }

  private renderPlanePass(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    layers: ScenePlaneLayer[],
    camera: SceneCamera,
    transparent: boolean,
    temporaryBuffers: GPUBuffer[],
    maskTextureManager?: MaskTextureManager | null,
  ): boolean {
    if (layers.length === 0) {
      return true;
    }
    if (
      !this.sceneView ||
      !this.sceneDepthView ||
      !this.planePipelineOpaque ||
      !this.planePipelineTransparent ||
      !this.planeBindGroupLayout ||
      !this.planeSampler ||
      !this.planeWhiteMaskView
    ) {
      return false;
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.sceneView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.sceneDepthView,
        depthClearValue: 1,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
      label: transparent ? 'native-scene-plane-transparent-pass' : 'native-scene-plane-opaque-pass',
    });
    renderPass.setPipeline(transparent ? this.planePipelineTransparent : this.planePipelineOpaque);

    for (const layer of layers) {
      const textureView = this.resolvePlaneTextureView(device, layer);
      if (!textureView) {
        renderPass.end();
        return false;
      }

      const uniformBuffer = device.createBuffer({
        size: PLANE_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `native-scene-plane-uniform-${layer.layerId}`,
      });
      temporaryBuffers.push(uniformBuffer);
      const uniformData = buildPlaneUniformData(
        buildPlaneMvp(layer, camera),
        layer.opacity,
        !transparent && layer.alphaMode === 'opaque',
        !!(layer.maskClipId && maskTextureManager?.hasMaskTexture(layer.maskClipId)),
        layer.maskInvert === true,
      );
      device.queue.writeBuffer(
        uniformBuffer,
        0,
        uniformData.buffer,
        uniformData.byteOffset,
        uniformData.byteLength,
      );

      const maskTextureView = layer.maskClipId && maskTextureManager
        ? maskTextureManager.getMaskInfo(layer.maskClipId).view
        : this.planeWhiteMaskView;

      const bindGroup = device.createBindGroup({
        layout: this.planeBindGroupLayout,
        entries: [
          { binding: 0, resource: this.planeSampler },
          { binding: 1, resource: textureView },
          { binding: 2, resource: { buffer: uniformBuffer } },
          { binding: 3, resource: maskTextureView },
        ],
        label: `native-scene-plane-bind-group-${layer.layerId}`,
      });
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(6);
    }

    renderPass.end();
    return true;
  }

  private resolvePlaneTextureView(
    device: GPUDevice,
    layer: ScenePlaneLayer,
  ): GPUTextureView | null {
    const current = this.planeTextures.get(layer.layerId);
    const sourceState = resolvePlaneTextureSource(layer, current);
    if (!sourceState) {
      return layer.videoElement || layer.videoFrame ? current?.view ?? null : null;
    }
    const sameSource = sourceState.transient === true || current?.source === sourceState.source;
    const canReuseCurrent =
      !!current &&
      sameSource &&
      current.width === sourceState.width &&
      current.height === sourceState.height;

    let cached = current;
    if (
      !cached ||
      (sourceState.transient !== true && cached.source !== sourceState.source) ||
      cached.width !== sourceState.width ||
      cached.height !== sourceState.height
    ) {
      cached?.texture.destroy();
      const texture = device.createTexture({
        size: { width: sourceState.width, height: sourceState.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      cached = {
        source: sourceState.source,
        texture,
        view: texture.createView(),
        width: sourceState.width,
        height: sourceState.height,
        ...(sourceState.videoCanvas ? { videoCanvas: sourceState.videoCanvas } : {}),
      };
      this.planeTextures.set(layer.layerId, cached);
    } else if (sourceState.videoCanvas) {
      cached.videoCanvas = sourceState.videoCanvas;
      cached.source = sourceState.source;
    } else if (sourceState.transient) {
      cached.source = sourceState.source;
    }

    try {
      device.queue.copyExternalImageToTexture(
        { source: sourceState.source },
        { texture: cached.texture },
        { width: sourceState.width, height: sourceState.height },
      );
    } catch (error) {
      if (canReuseCurrent) {
        return cached.view;
      }
      log.warn('Failed to upload native plane texture', { layerId: layer.layerId, error });
      return null;
    }

    return cached.view;
  }

  private prunePlaneTextureCache(activeLayerIds: Set<string>): void {
    for (const [layerId, entry] of this.planeTextures) {
      if (!activeLayerIds.has(layerId)) {
        entry.texture.destroy();
        this.planeTextures.delete(layerId);
      }
    }
  }
}

let instance: NativeSceneRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.nativeSceneRenderer) {
    instance = import.meta.hot.data.nativeSceneRenderer;
  }
  import.meta.hot.dispose((data) => {
    instance?.dispose();
    data.nativeSceneRenderer = null;
    instance = null;
  });
}

export function getNativeSceneRenderer(): NativeSceneRenderer {
  if (!instance) {
    instance = new NativeSceneRenderer();
  }
  return instance;
}
