import { Logger } from '../../services/logger';
import { getGaussianSplatGpuRenderer } from '../gaussian/core/GaussianSplatGpuRenderer';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';
import { resolveSharedSplatSceneKey } from '../scene/runtime/SharedSplatRuntimeUtils';
import type {
  SceneCamera,
  SceneGizmoRenderOptions,
  SceneLayer3DData,
  SceneModelLayer,
  ScenePlaneLayer,
  SceneSplatEffectorRuntimeData,
  SceneSplatLayer,
} from '../scene/types';
import { ModelRuntimeCache } from './assets/ModelRuntimeCache';
import { EffectorCompute } from './passes/EffectorCompute';
import { GizmoPass } from './passes/GizmoPass';
import { MeshPass, type SceneNativeMeshLayer } from './passes/MeshPass';
import { PlanePass } from './passes/PlanePass';
import { SplatPass } from './passes/SplatPass';
import planeShaderSource from './shaders/PlanePass.wgsl?raw';
import compositeShaderSource from './shaders/SceneTextureComposite.wgsl?raw';

const log = Logger.create('NativeSceneRenderer');
const PLANE_UNIFORM_SIZE = 80;
const SCENE_DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
const WORLD_HEIGHT = 2.0;
const SPLAT_SOFT_DEPTH_ALPHA_CUTOFF = 0.42;

interface CachedPlaneTexture {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  videoCanvas?: HTMLCanvasElement;
}

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
  private planeTextures = new Map<string, CachedPlaneTexture>();
  private readonly planePass = new PlanePass();
  private readonly meshPass = new MeshPass();
  private readonly gizmoPass = new GizmoPass();
  private readonly splatPass = new SplatPass();
  private readonly effectorCompute = new EffectorCompute();
  private readonly modelRuntimeCache = new ModelRuntimeCache();

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

  async preloadModel(url: string, fileName: string): Promise<boolean> {
    if (!url) {
      return false;
    }

    this.modelRuntimeCache.touch(url, fileName);
    return this.modelRuntimeCache.preload(url, fileName);
  }

  renderScene(
    device: GPUDevice,
    layers: SceneLayer3DData[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
  ): GPUTextureView | null {
    if (!this.initialized) {
      return null;
    }

    const planeLayers = this.planePass.collect(layers);
    const meshLayers = this.meshPass.collect(layers);
    const nativeMeshLayers = this.meshPass.collectNativeLayers(layers);
    const splatLayers = this.splatPass.collect(layers);

    for (const layer of meshLayers) {
      if (layer.kind !== 'model' || !layer.modelUrl) {
        continue;
      }
      this.modelRuntimeCache.touch(layer.modelUrl, layer.modelFileName);
      if (!this.modelRuntimeCache.isLoaded(layer.modelUrl)) {
        void this.modelRuntimeCache.preload(
          layer.modelUrl,
          layer.modelFileName,
          this.getModelPreloadOptions(layer),
        );
      }
      this.preloadNearbyModelSequenceFrames(layer, realtimePlayback);
    }

    if (!this.canRenderNativeScene(layers, planeLayers, nativeMeshLayers, splatLayers)) {
      return null;
    }

    const nativeSceneView = this.renderNativeScene(
      device,
      planeLayers,
      nativeMeshLayers,
      splatLayers,
      camera,
      effectors,
      realtimePlayback,
      gizmo,
    );
    if (!nativeSceneView) {
      return null;
    }

    log.debug('Rendered native shared scene frame', {
      totalLayers: layers.length,
      planes: planeLayers.length,
      meshes: meshLayers.length,
      splats: splatLayers.length,
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
    if (
      this.sceneTexture &&
      this.sceneTexture.width === width &&
      this.sceneTexture.height === height &&
      this.sceneView &&
      this.sceneDepthTexture &&
      this.sceneDepthTexture.width === width &&
      this.sceneDepthTexture.height === height &&
      this.sceneDepthView
    ) {
      return;
    }

    this.sceneTexture?.destroy();
    this.sceneDepthTexture?.destroy();
    this.sceneTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sceneView = this.sceneTexture.createView();
    this.sceneDepthTexture = device.createTexture({
      size: { width, height },
      format: SCENE_DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sceneDepthView = this.sceneDepthTexture.createView();
  }

  private canRenderNativeScene(
    layers: SceneLayer3DData[],
    planeLayers: ScenePlaneLayer[],
    nativeMeshLayers: SceneNativeMeshLayer[],
    splatLayers: SceneSplatLayer[],
  ): boolean {
    return (
      layers.length > 0 &&
      layers.length === planeLayers.length + nativeMeshLayers.length + splatLayers.length
    );
  }

  private renderNativeScene(
    device: GPUDevice,
    planeLayers: ScenePlaneLayer[],
    nativeMeshLayers: SceneNativeMeshLayer[],
    layers: SceneSplatLayer[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
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
    this.gizmoPass.initialize(device, 'rgba8unorm');
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
    const sortedLayers = [...layers].sort((a, b) =>
      this.getSceneLayerDepth(a.worldMatrix, camera.viewMatrix) -
      this.getSceneLayerDepth(b.worldMatrix, camera.viewMatrix),
    );
    const temporaryBuffers: GPUBuffer[] = [];
    const opaqueMeshes = nativeMeshLayers.filter((layer) => !this.meshPass.isTransparent(layer, this.modelRuntimeCache));
    const transparentMeshes = nativeMeshLayers
      .filter((layer) => this.meshPass.isTransparent(layer, this.modelRuntimeCache))
      .sort((a, b) =>
        this.getSceneLayerDepth(a.worldMatrix, camera.viewMatrix) -
        this.getSceneLayerDepth(b.worldMatrix, camera.viewMatrix),
      );
    const activeModelUrls = new Set(
      nativeMeshLayers
        .filter((layer): layer is Extract<SceneNativeMeshLayer, { kind: 'model' }> =>
          layer.kind === 'model' && !!layer.modelUrl,
        )
        .map((layer) => layer.modelUrl!),
    );
    const opaquePlanes = planeLayers.filter((layer) => this.isDepthWritingPlane(layer));
    const transparentPlanes = planeLayers
      .filter((layer) => !this.isDepthWritingPlane(layer))
      .sort((a, b) =>
        this.getSceneLayerDepth(a.worldMatrix, camera.viewMatrix) -
        this.getSceneLayerDepth(b.worldMatrix, camera.viewMatrix),
      );
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
      this.modelRuntimeCache,
      temporaryBuffers,
      false,
    )) {
      return null;
    }

    if (!this.renderPlanePass(device, commandEncoder, opaquePlanes, camera, false, temporaryBuffers)) {
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
      this.modelRuntimeCache,
      temporaryBuffers,
      true,
    )) {
      return null;
    }

    if (!this.renderPlanePass(device, commandEncoder, transparentPlanes, camera, true, temporaryBuffers)) {
      return null;
    }
    const gizmoLayer = gizmo
      ? [...planeLayers, ...nativeMeshLayers, ...layers].find((layer) => layer.clipId === gizmo.clipId) ??
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

    this.compositeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
      label: 'native-scene-composite-bind-group-layout',
    });

    const shaderModule = device.createShaderModule({
      code: compositeShaderSource,
      label: 'native-scene-composite-shader',
    });

    this.compositePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.compositeBindGroupLayout],
        label: 'native-scene-composite-pipeline-layout',
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
      label: 'native-scene-composite-pipeline',
    });

    this.compositeSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  private ensurePlaneResources(device: GPUDevice): void {
    if (
      this.planePipelineOpaque &&
      this.planePipelineTransparent &&
      this.planeBindGroupLayout &&
      this.planeSampler
    ) {
      return;
    }

    this.planeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'native-scene-plane-bind-group-layout',
    });

    const shaderModule = device.createShaderModule({
      code: planeShaderSource,
      label: 'native-scene-plane-shader',
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.planeBindGroupLayout],
      label: 'native-scene-plane-pipeline-layout',
    });

    this.planePipelineOpaque = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: 'rgba8unorm',
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: SCENE_DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      label: 'native-scene-plane-opaque-pipeline',
    });

    this.planePipelineTransparent = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: SCENE_DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      label: 'native-scene-plane-transparent-pipeline',
    });

    this.planeSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  private renderPlanePass(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    layers: ScenePlaneLayer[],
    camera: SceneCamera,
    transparent: boolean,
    temporaryBuffers: GPUBuffer[],
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
      !this.planeSampler
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
      const uniformData = this.buildPlaneUniformData(
        this.buildPlaneMvp(layer, camera),
        layer.opacity,
        !transparent && layer.alphaMode === 'opaque',
      );
      device.queue.writeBuffer(
        uniformBuffer,
        0,
        uniformData.buffer,
        uniformData.byteOffset,
        uniformData.byteLength,
      );

      const bindGroup = device.createBindGroup({
        layout: this.planeBindGroupLayout,
        entries: [
          { binding: 0, resource: this.planeSampler },
          { binding: 1, resource: textureView },
          { binding: 2, resource: { buffer: uniformBuffer } },
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
    const sourceState = this.resolvePlaneTextureSource(layer, current);
    if (!sourceState) {
      return layer.videoElement ? current?.view ?? null : null;
    }
    const canReuseCurrent =
      !!current &&
      current.source === sourceState.source &&
      current.width === sourceState.width &&
      current.height === sourceState.height;

    let cached = current;
    if (
      !cached ||
      cached.source !== sourceState.source ||
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

  private getModelPreloadOptions(layer: SceneModelLayer) {
    const sequence = layer.modelSequence;
    if (!sequence || sequence.frames.length <= 1) {
      return undefined;
    }

    const anchorFrame = sequence.frames.find((frame) => !!frame.modelUrl);
    if (!anchorFrame?.modelUrl) {
      return undefined;
    }

    const sequenceKey = [
      sequence.sequenceName ?? 'model-sequence',
      sequence.frameCount,
      sequence.fps,
      anchorFrame.name,
      anchorFrame.modelUrl,
    ].join('|');

    return {
      normalizationKey: sequenceKey,
      anchorUrl: anchorFrame.modelUrl,
      anchorFileName: anchorFrame.name,
    };
  }

  private preloadNearbyModelSequenceFrames(layer: SceneModelLayer, realtimePlayback: boolean): void {
    const sequence = layer.modelSequence;
    if (!realtimePlayback || !sequence || sequence.frames.length <= 1 || !layer.modelUrl) {
      return;
    }

    const currentIndex = sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl);
    if (currentIndex < 0) {
      return;
    }

    const options = this.getModelPreloadOptions(layer);
    for (const offset of [1, 2, -1]) {
      const frame = sequence.frames[currentIndex + offset];
      if (!frame?.modelUrl || this.modelRuntimeCache.isLoaded(frame.modelUrl)) {
        continue;
      }
      void this.modelRuntimeCache.preload(frame.modelUrl, frame.name, options);
    }
  }

  private resolvePlaneTextureSource(
    layer: ScenePlaneLayer,
    cached?: CachedPlaneTexture,
  ): {
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
    width: number;
    height: number;
    videoCanvas?: HTMLCanvasElement;
  } | null {
    if (layer.videoElement) {
      const width = Math.max(
        1,
        Math.floor(layer.videoElement.videoWidth || layer.sourceWidth || 1),
      );
      const height = Math.max(
        1,
        Math.floor(layer.videoElement.videoHeight || layer.sourceHeight || 1),
      );
      if ((layer.videoElement.readyState ?? 0) < 2) {
        return null;
      }

      if (layer.preciseVideoSampling) {
        if (typeof document === 'undefined') {
          return null;
        }
        let videoCanvas = cached?.videoCanvas;
        if (!videoCanvas || videoCanvas.width !== width || videoCanvas.height !== height) {
          videoCanvas = document.createElement('canvas');
          videoCanvas.width = width;
          videoCanvas.height = height;
        }
        const context = videoCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false,
        });
        if (!context) {
          return null;
        }
        try {
          context.clearRect(0, 0, width, height);
          context.drawImage(layer.videoElement, 0, 0, width, height);
        } catch (error) {
          log.warn('Failed to draw precise native 3D video plane frame', {
            layerId: layer.layerId,
            error,
          });
          return null;
        }
        return {
          source: videoCanvas,
          width,
          height,
          videoCanvas,
        };
      }

      return {
        source: layer.videoElement,
        width,
        height,
      };
    }

    if (layer.imageElement) {
      const width = Math.max(
        1,
        Math.floor(layer.imageElement.naturalWidth || layer.sourceWidth || 1),
      );
      const height = Math.max(
        1,
        Math.floor(layer.imageElement.naturalHeight || layer.sourceHeight || 1),
      );
      return {
        source: layer.imageElement,
        width,
        height,
      };
    }

    if (layer.canvas) {
      const width = Math.max(1, Math.floor(layer.canvas.width || layer.sourceWidth || 1));
      const height = Math.max(1, Math.floor(layer.canvas.height || layer.sourceHeight || 1));
      return {
        source: layer.canvas,
        width,
        height,
      };
    }

    return null;
  }

  private buildPlaneUniformData(
    mvp: Float32Array,
    opacity: number,
    forceOpaqueAlpha: boolean,
  ): Float32Array {
    const data = new Float32Array(PLANE_UNIFORM_SIZE / 4);
    data.set(mvp, 0);
    data[16] = opacity;
    data[17] = forceOpaqueAlpha ? 1 : 0;
    return data;
  }

  private buildPlaneMvp(layer: ScenePlaneLayer, camera: SceneCamera): Float32Array {
    const planeScale = this.createPlaneScaleMatrix(layer, camera.viewport);
    const modelMatrix = this.multiplyMat4(layer.worldMatrix, planeScale);
    const viewProjection = this.multiplyMat4(camera.projectionMatrix, camera.viewMatrix);
    return this.multiplyMat4(viewProjection, modelMatrix);
  }

  private createPlaneScaleMatrix(
    layer: ScenePlaneLayer,
    viewport: { width: number; height: number },
  ): Float32Array {
    const outputAspect = viewport.width / Math.max(viewport.height, 1);
    const sourceAspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
    let planeWidth: number;
    let planeHeight: number;

    if (sourceAspect >= outputAspect) {
      planeWidth = WORLD_HEIGHT * outputAspect;
      planeHeight = planeWidth / Math.max(sourceAspect, 1e-6);
    } else {
      planeHeight = WORLD_HEIGHT;
      planeWidth = planeHeight * sourceAspect;
    }

    return new Float32Array([
      planeWidth, 0, 0, 0,
      0, planeHeight, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }

  private isDepthWritingPlane(layer: ScenePlaneLayer): boolean {
    if (layer.castsDepth === false) {
      return false;
    }
    if (layer.opacity < 1) {
      return false;
    }
    if (layer.alphaMode === 'straight' || layer.alphaMode === 'premultiplied') {
      return false;
    }
    if (layer.alphaMode === 'opaque') {
      return true;
    }
    return !!layer.videoElement;
  }

  private prunePlaneTextureCache(activeLayerIds: Set<string>): void {
    for (const [layerId, entry] of this.planeTextures) {
      if (!activeLayerIds.has(layerId)) {
        entry.texture.destroy();
        this.planeTextures.delete(layerId);
      }
    }
  }

  private multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + row] * b[col * 4 + k];
        }
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }

  private getSceneLayerDepth(worldMatrix: Float32Array, viewMatrix: Float32Array): number {
    const x = worldMatrix[12] ?? 0;
    const y = worldMatrix[13] ?? 0;
    const z = worldMatrix[14] ?? 0;
    return (
      (viewMatrix[2] ?? 0) * x +
      (viewMatrix[6] ?? 0) * y +
      (viewMatrix[10] ?? 0) * z +
      (viewMatrix[14] ?? 0)
    );
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
