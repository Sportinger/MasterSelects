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
import type { ModelSequenceData } from '../../types';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import { ModelRuntimeCache, type ModelRuntimePreloadOptions } from './assets/ModelRuntimeCache';
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
const MODEL_SEQUENCE_CPU_PRELOAD_AHEAD = 4;
const MODEL_SEQUENCE_CPU_PRELOAD_BEHIND = 1;
const MODEL_SEQUENCE_MAX_NEW_PRELOADS_PER_FRAME = 1;
const MODEL_SEQUENCE_MAX_REALTIME_LOADS = 1;
const MODEL_SEQUENCE_GPU_RETAIN_AHEAD = 8;
const MODEL_SEQUENCE_GPU_RETAIN_BEHIND = 3;

interface CachedPlaneTexture {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | VideoFrame;
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
    return this.modelRuntimeCache.preload(url, fileName, this.getModelSequencePreloadOptions(modelSequence));
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
    const preparedMeshLayers = meshLayers.map((layer) =>
      layer.kind === 'model'
        ? this.prepareModelLayerForRender(layer, realtimePlayback)
        : layer,
    );
    const nativeMeshLayers = this.meshPass.collectNativeLayers(preparedMeshLayers);

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
    const activeModelUrls = this.collectRetainedModelUrls(nativeMeshLayers);
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
      this.planeSampler &&
      this.planeWhiteMaskView
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
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
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

    this.planeWhiteMaskTexture?.destroy();
    this.planeWhiteMaskTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING,
      label: 'native-scene-plane-white-mask-texture',
    });
    this.planeWhiteMaskView = this.planeWhiteMaskTexture.createView();
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
      const uniformData = this.buildPlaneUniformData(
        this.buildPlaneMvp(layer, camera),
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
    const sourceState = this.resolvePlaneTextureSource(layer, current);
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

  private getModelPreloadOptions(layer: SceneModelLayer): ModelRuntimePreloadOptions {
    return this.getModelSequencePreloadOptions(layer.modelSequence);
  }

  private getModelSequencePreloadOptions(sequence: ModelSequenceData | undefined): ModelRuntimePreloadOptions {
    if (!sequence || sequence.frames.length <= 1) {
      return {};
    }

    const anchorFrame = sequence.frames.find((frame) => !!frame.modelUrl);
    if (!anchorFrame?.modelUrl) {
      return {};
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

  private prepareModelLayerForRender(layer: SceneModelLayer, realtimePlayback: boolean): SceneModelLayer {
    if (!layer.modelUrl) {
      return layer;
    }

    const options = this.getModelPreloadOptions(layer);
    this.modelRuntimeCache.touch(layer.modelUrl, layer.modelFileName);
    if (!this.modelRuntimeCache.isLoaded(layer.modelUrl, options)) {
      this.scheduleModelRuntimePreload(layer.modelUrl, layer.modelFileName, options, realtimePlayback && !!layer.modelSequence);
    }
    this.preloadNearbyModelSequenceFrames(layer, realtimePlayback, options);

    const sequence = layer.modelSequence;
    if (!sequence || sequence.frames.length <= 1) {
      return layer;
    }

    if (this.modelRuntimeCache.isLoaded(layer.modelUrl, options)) {
      this.lastRenderableModelSequenceUrls.set(layer.clipId, layer.modelUrl);
      return layer;
    }

    if (!realtimePlayback) {
      return layer;
    }

    const fallbackFrame = this.findRenderableModelSequenceFrame(layer, options);
    if (!fallbackFrame?.modelUrl || fallbackFrame.modelUrl === layer.modelUrl) {
      return layer;
    }

    return {
      ...layer,
      modelUrl: fallbackFrame.modelUrl,
      modelFileName: fallbackFrame.name,
    };
  }

  private findRenderableModelSequenceFrame(
    layer: SceneModelLayer,
    options: ModelRuntimePreloadOptions,
  ): NonNullable<SceneModelLayer['modelSequence']>['frames'][number] | null {
    const sequence = layer.modelSequence;
    if (!sequence || sequence.frames.length === 0) {
      return null;
    }

    const lastUrl = this.lastRenderableModelSequenceUrls.get(layer.clipId);
    if (lastUrl && this.modelRuntimeCache.isLoaded(lastUrl, options)) {
      return sequence.frames.find((frame) => frame.modelUrl === lastUrl) ?? null;
    }

    const currentIndex = layer.modelUrl
      ? sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl)
      : -1;
    if (currentIndex < 0) {
      return null;
    }

    for (let offset = 1; offset < sequence.frames.length; offset += 1) {
      const previous = sequence.frames[currentIndex - offset];
      if (previous?.modelUrl && this.modelRuntimeCache.isLoaded(previous.modelUrl, options)) {
        return previous;
      }
      const next = sequence.frames[currentIndex + offset];
      if (next?.modelUrl && this.modelRuntimeCache.isLoaded(next.modelUrl, options)) {
        return next;
      }
    }

    return null;
  }

  private preloadNearbyModelSequenceFrames(
    layer: SceneModelLayer,
    realtimePlayback: boolean,
    options: ModelRuntimePreloadOptions,
  ): void {
    const sequence = layer.modelSequence;
    if (!realtimePlayback || !sequence || sequence.frames.length <= 1 || !layer.modelUrl) {
      return;
    }

    const currentIndex = sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl);
    if (currentIndex < 0) {
      return;
    }

    const offsets = [
      ...Array.from({ length: MODEL_SEQUENCE_CPU_PRELOAD_AHEAD }, (_, index) => index + 1),
      ...Array.from({ length: MODEL_SEQUENCE_CPU_PRELOAD_BEHIND }, (_, index) => -(index + 1)),
    ];
    let scheduled = 0;
    for (const offset of offsets) {
      if (scheduled >= MODEL_SEQUENCE_MAX_NEW_PRELOADS_PER_FRAME) {
        break;
      }
      const frame = sequence.frames[currentIndex + offset];
      if (
        !frame?.modelUrl ||
        this.modelRuntimeCache.isLoaded(frame.modelUrl, options) ||
        this.modelRuntimeCache.isLoading(frame.modelUrl)
      ) {
        continue;
      }
      if (this.scheduleModelRuntimePreload(frame.modelUrl, frame.name, options, true)) {
        scheduled += 1;
      }
    }
  }

  private scheduleModelRuntimePreload(
    url: string,
    fileName: string | undefined,
    options: ModelRuntimePreloadOptions,
    realtimeSequence: boolean,
  ): boolean {
    if (this.modelRuntimeCache.isLoaded(url, options) || this.modelRuntimeCache.isLoading(url)) {
      return false;
    }
    if (realtimeSequence && this.modelRuntimeCache.loadingCount() >= MODEL_SEQUENCE_MAX_REALTIME_LOADS) {
      return false;
    }
    void this.modelRuntimeCache.preload(url, fileName, options);
    return true;
  }

  private collectRetainedModelUrls(nativeMeshLayers: SceneNativeMeshLayer[]): Set<string> {
    const activeModelUrls = new Set<string>();
    for (const layer of nativeMeshLayers) {
      if (layer.kind !== 'model' || !layer.modelUrl) {
        continue;
      }

      activeModelUrls.add(layer.modelUrl);
      const lastUrl = this.lastRenderableModelSequenceUrls.get(layer.clipId);
      if (lastUrl) {
        activeModelUrls.add(lastUrl);
      }

      const sequence = layer.modelSequence;
      if (!sequence || sequence.frames.length <= 1) {
        continue;
      }

      const currentIndex = sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl);
      if (currentIndex < 0) {
        continue;
      }

      const start = Math.max(0, currentIndex - MODEL_SEQUENCE_GPU_RETAIN_BEHIND);
      const end = Math.min(sequence.frames.length - 1, currentIndex + MODEL_SEQUENCE_GPU_RETAIN_AHEAD);
      for (let index = start; index <= end; index += 1) {
        const frameUrl = sequence.frames[index]?.modelUrl;
        if (frameUrl) {
          activeModelUrls.add(frameUrl);
        }
      }
    }
    return activeModelUrls;
  }

  private resolvePlaneTextureSource(
    layer: ScenePlaneLayer,
    cached?: CachedPlaneTexture,
  ): {
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | VideoFrame;
    width: number;
    height: number;
    transient?: boolean;
    videoCanvas?: HTMLCanvasElement;
  } | null {
    if (layer.videoFrame) {
      const width = Math.max(
        1,
        Math.floor(layer.videoFrame.displayWidth || layer.videoFrame.codedWidth || layer.sourceWidth || 1),
      );
      const height = Math.max(
        1,
        Math.floor(layer.videoFrame.displayHeight || layer.videoFrame.codedHeight || layer.sourceHeight || 1),
      );
      return {
        source: layer.videoFrame,
        width,
        height,
        transient: true,
      };
    }

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
    hasMask: boolean,
    maskInvert: boolean,
  ): Float32Array {
    const data = new Float32Array(PLANE_UNIFORM_SIZE / 4);
    data.set(mvp, 0);
    data[16] = opacity;
    data[17] = forceOpaqueAlpha ? 1 : 0;
    data[18] = hasMask ? 1 : 0;
    data[19] = maskInvert ? 1 : 0;
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
    if (layer.maskClipId) {
      return false;
    }
    if (layer.alphaMode === 'straight' || layer.alphaMode === 'premultiplied') {
      return false;
    }
    if (layer.alphaMode === 'opaque') {
      return true;
    }
    return !!(layer.videoElement || layer.videoFrame);
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
