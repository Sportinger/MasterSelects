import type {
  SceneCamera,
  SceneLayer3DData,
  ScenePrimitiveLayer,
  SceneSplatEffectorRuntimeData,
  SceneText3DLayer,
  SceneModelLayer,
} from '../../scene/types';
import { ModelRuntimeCache, type ModelRuntimeTexture } from '../assets/ModelRuntimeCache';
import { TextMeshCache } from '../assets/TextMeshCache';
import { MESH_UNIFORM_SIZE } from './meshPass/constants';
import {
  buildEdgeIndices,
  createPrimitiveGeometry,
  type PrimitiveGeometryData,
} from './meshPass/primitiveGeometry';
import { createMeshPipelineResources } from './meshPass/pipelineResources';
import { resolveMeshLayerColor } from './meshPass/materials';
import { buildMeshMatrixPlan } from './meshPass/transforms';
import { buildMeshUniformData } from './meshPass/uniforms';

export type SceneMeshLayer = ScenePrimitiveLayer | SceneText3DLayer | SceneModelLayer;
export type SceneNativeMeshLayer = ScenePrimitiveLayer | SceneText3DLayer | SceneModelLayer;

interface PrimitiveGpuResources {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  edgeIndexBuffer: GPUBuffer;
  edgeIndexCount: number;
  baseColor?: readonly [number, number, number, number];
  unlit?: boolean;
  texture?: GPUTexture;
  textureView?: GPUTextureView;
}

export class MeshPass {
  private meshPipelineOpaque: GPURenderPipeline | null = null;
  private meshPipelineTransparent: GPURenderPipeline | null = null;
  private meshPipelineWireframe: GPURenderPipeline | null = null;
  private meshBindGroupLayout: GPUBindGroupLayout | null = null;
  private primitiveCache = new Map<ScenePrimitiveLayer['meshType'], PrimitiveGpuResources>();
  private textCache = new Map<string, PrimitiveGpuResources>();
  private modelCache = new Map<string, PrimitiveGpuResources[]>();
  private meshSampler: GPUSampler | null = null;
  private defaultTexture: GPUTexture | null = null;
  private defaultTextureView: GPUTextureView | null = null;
  private readonly textMeshCache = new TextMeshCache();

  supports(layer: SceneLayer3DData): layer is SceneMeshLayer {
    return layer.kind === 'primitive' || layer.kind === 'text3d' || layer.kind === 'model';
  }

  supportsNative(layer: SceneLayer3DData): layer is SceneNativeMeshLayer {
    return layer.kind === 'primitive' || layer.kind === 'text3d' || layer.kind === 'model';
  }

  collect(layers: SceneLayer3DData[]): SceneMeshLayer[] {
    return layers.filter((layer): layer is SceneMeshLayer => this.supports(layer));
  }

  collectNativeLayers(layers: SceneLayer3DData[]): SceneNativeMeshLayer[] {
    return layers.filter((layer): layer is SceneNativeMeshLayer => this.supportsNative(layer));
  }

  isTransparent(layer: SceneNativeMeshLayer, modelRuntimeCache?: ModelRuntimeCache): boolean {
    if (layer.wireframe === true || layer.opacity < 1) {
      return true;
    }
    if (layer.kind === 'model' && layer.modelUrl) {
      return !!modelRuntimeCache
        ?.get(layer.modelUrl)
        ?.primitives
        .some((primitive) => primitive.baseColor[3] < 0.999);
    }
    return false;
  }

  initialize(device: GPUDevice, depthFormat: GPUTextureFormat): void {
    if (
      this.meshPipelineOpaque &&
      this.meshPipelineTransparent &&
      this.meshPipelineWireframe &&
      this.meshBindGroupLayout
    ) {
      return;
    }

    const resources = createMeshPipelineResources(device, depthFormat);
    this.meshPipelineOpaque = resources.opaquePipeline;
    this.meshPipelineTransparent = resources.transparentPipeline;
    this.meshPipelineWireframe = resources.wireframePipeline;
    this.meshBindGroupLayout = resources.bindGroupLayout;
    this.meshSampler = resources.sampler;
    this.ensureDefaultTexture(device);
  }

  renderPrimitivePass(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView,
    layers: SceneNativeMeshLayer[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    modelRuntimeCache: ModelRuntimeCache,
    temporaryBuffers: GPUBuffer[],
    transparent: boolean,
  ): boolean {
    if (layers.length === 0) {
      return true;
    }
    if (
      !this.meshPipelineOpaque ||
      !this.meshPipelineTransparent ||
      !this.meshPipelineWireframe ||
      !this.meshBindGroupLayout ||
      !this.meshSampler ||
      !this.defaultTextureView
    ) {
      return false;
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: sceneView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: sceneDepthView,
        depthClearValue: 1,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
      label: transparent ? 'native-scene-mesh-transparent-pass' : 'native-scene-mesh-opaque-pass',
    });

    for (const layer of layers) {
      const resourcesList = this.getOrCreateResources(device, layer, modelRuntimeCache);
      if (!resourcesList || resourcesList.length === 0) {
        renderPass.end();
        return false;
      }

      const { modelMatrix, mvp } = buildMeshMatrixPlan(layer, camera, effectors);

      for (let resourceIndex = 0; resourceIndex < resourcesList.length; resourceIndex += 1) {
        const resources = resourcesList[resourceIndex]!;
        const color = resolveMeshLayerColor(layer, resources.baseColor);
        const uniformBuffer = device.createBuffer({
          size: MESH_UNIFORM_SIZE,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `native-scene-mesh-uniform-${layer.layerId}-${resourceIndex}`,
        });
        temporaryBuffers.push(uniformBuffer);
        const uniformData = buildMeshUniformData(
          mvp,
          modelMatrix,
          color,
          layer.opacity,
          resources.unlit === true,
        );
        device.queue.writeBuffer(
          uniformBuffer,
          0,
          uniformData.buffer,
          uniformData.byteOffset,
          uniformData.byteLength,
        );

        const bindGroup = device.createBindGroup({
          layout: this.meshBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: this.meshSampler },
            { binding: 2, resource: resources.textureView ?? this.defaultTextureView },
          ],
          label: `native-scene-mesh-bind-group-${layer.layerId}-${resourceIndex}`,
        });

        renderPass.setPipeline(
          layer.wireframe === true
            ? this.meshPipelineWireframe
            : (transparent ? this.meshPipelineTransparent : this.meshPipelineOpaque),
        );
        renderPass.setBindGroup(0, bindGroup);
        renderPass.setVertexBuffer(0, resources.vertexBuffer);

        if (layer.wireframe === true) {
          renderPass.setIndexBuffer(resources.edgeIndexBuffer, 'uint32');
          renderPass.drawIndexed(resources.edgeIndexCount);
        } else {
          renderPass.setIndexBuffer(resources.indexBuffer, 'uint32');
          renderPass.drawIndexed(resources.indexCount);
        }
      }
    }

    renderPass.end();
    return true;
  }

  dispose(): void {
    this.meshPipelineOpaque = null;
    this.meshPipelineTransparent = null;
    this.meshPipelineWireframe = null;
    this.meshBindGroupLayout = null;
    this.meshSampler = null;
    for (const resources of this.primitiveCache.values()) {
      this.destroyResources(resources);
    }
    this.primitiveCache.clear();
    for (const resources of this.textCache.values()) {
      this.destroyResources(resources);
    }
    this.textCache.clear();
    for (const resourcesList of this.modelCache.values()) {
      for (const resources of resourcesList) {
        this.destroyResources(resources);
      }
    }
    this.modelCache.clear();
    this.defaultTexture?.destroy();
    this.defaultTexture = null;
    this.defaultTextureView = null;
    this.textMeshCache.clear();
  }

  pruneModelCache(activeModelUrls: Set<string>): void {
    for (const [modelUrl, resourcesList] of this.modelCache) {
      if (activeModelUrls.has(modelUrl)) {
        continue;
      }
      for (const resources of resourcesList) {
        this.destroyResources(resources);
      }
      this.modelCache.delete(modelUrl);
    }
  }

  private getOrCreateResources(
    device: GPUDevice,
    layer: SceneNativeMeshLayer,
    modelRuntimeCache: ModelRuntimeCache,
  ): PrimitiveGpuResources[] | null {
    if (layer.kind === 'primitive') {
      const cached = this.primitiveCache.get(layer.meshType);
      if (cached) {
        return [cached];
      }

      const geometry = createPrimitiveGeometry(layer.meshType);
      if (!geometry) {
        return null;
      }

      const resources = this.createGpuResources(device, geometry, `native-scene-primitive-${layer.meshType}`);
      this.primitiveCache.set(layer.meshType, resources);
      return [resources];
    }

    if (layer.kind === 'text3d') {
      const textKey = this.textMeshCache.getKey(layer.text3DProperties);
      const cached = this.textCache.get(textKey);
      if (cached) {
        return [cached];
      }

      const geometry = this.textMeshCache.getOrCreate(layer.text3DProperties);
      const resources = this.createGpuResources(device, geometry, `native-scene-text-${layer.layerId}`);
      this.textCache.set(textKey, resources);
      return [resources];
    }

    if (!layer.modelUrl) {
      return null;
    }

    const cached = this.modelCache.get(layer.modelUrl);
    if (cached) {
      return cached;
    }

    const runtime = modelRuntimeCache.get(layer.modelUrl);
    if (!runtime || runtime.primitives.length === 0) {
      return null;
    }

    const resourcesList = runtime.primitives.map((primitive, primitiveIndex) => this.createGpuResources(
      device,
      {
        vertices: primitive.vertices,
        indices: primitive.indices,
        edgeIndices: buildEdgeIndices(primitive.indices),
      },
      `native-scene-model-${layer.layerId}-${primitiveIndex}`,
      primitive.baseColor,
      primitive.baseColorTexture,
      primitive.unlit,
    ));
    this.modelCache.set(layer.modelUrl, resourcesList);
    return resourcesList;
  }

  private createGpuResources(
    device: GPUDevice,
    geometry: PrimitiveGeometryData,
    label: string,
    baseColor?: readonly [number, number, number, number],
    baseColorTexture?: ModelRuntimeTexture,
    unlit = false,
  ): PrimitiveGpuResources {
    const vertexBuffer = device.createBuffer({
      size: geometry.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: `${label}-vertex`,
    });
    device.queue.writeBuffer(
      vertexBuffer,
      0,
      geometry.vertices.buffer,
      geometry.vertices.byteOffset,
      geometry.vertices.byteLength,
    );

    const indexBuffer = device.createBuffer({
      size: geometry.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: `${label}-index`,
    });
    device.queue.writeBuffer(
      indexBuffer,
      0,
      geometry.indices.buffer,
      geometry.indices.byteOffset,
      geometry.indices.byteLength,
    );

    const edgeIndexBuffer = device.createBuffer({
      size: geometry.edgeIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: `${label}-edge-index`,
    });
    device.queue.writeBuffer(
      edgeIndexBuffer,
      0,
      geometry.edgeIndices.buffer,
      geometry.edgeIndices.byteOffset,
      geometry.edgeIndices.byteLength,
    );

    const texture = baseColorTexture
      ? this.createTextureResource(device, baseColorTexture, label)
      : null;

    return {
      vertexBuffer,
      indexBuffer,
      indexCount: geometry.indices.length,
      edgeIndexBuffer,
      edgeIndexCount: geometry.edgeIndices.length,
      ...(baseColor ? { baseColor } : {}),
      ...(unlit ? { unlit: true } : {}),
      ...(texture ? { texture, textureView: texture.createView() } : {}),
    };
  }

  private createTextureResource(
    device: GPUDevice,
    texture: ModelRuntimeTexture,
    label: string,
  ): GPUTexture | null {
    if (texture.width <= 0 || texture.height <= 0) {
      return null;
    }

    const gpuTexture = device.createTexture({
      size: { width: texture.width, height: texture.height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: `${label}-base-color-texture`,
    });
    device.queue.copyExternalImageToTexture(
      { source: texture.image },
      { texture: gpuTexture },
      { width: texture.width, height: texture.height },
    );
    return gpuTexture;
  }

  private ensureDefaultTexture(device: GPUDevice): void {
    if (this.defaultTexture && this.defaultTextureView) {
      return;
    }

    this.defaultTexture?.destroy();
    this.defaultTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'native-scene-mesh-default-texture',
    });
    device.queue.writeTexture?.(
      { texture: this.defaultTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
    this.defaultTextureView = this.defaultTexture.createView();
  }

  private destroyResources(resources: PrimitiveGpuResources): void {
    resources.vertexBuffer.destroy();
    resources.indexBuffer.destroy();
    resources.edgeIndexBuffer.destroy();
    resources.texture?.destroy();
  }
}
