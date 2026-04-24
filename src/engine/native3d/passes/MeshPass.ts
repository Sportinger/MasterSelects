import { applySceneEffectorsToObjectTransform } from '../../scene/SceneEffectorUtils';
import type {
  SceneCamera,
  SceneLayer3DData,
  ScenePrimitiveLayer,
  SceneSplatEffectorRuntimeData,
  SceneText3DLayer,
  SceneModelLayer,
  SceneWorldTransform,
} from '../../scene/types';
import { ModelRuntimeCache } from '../assets/ModelRuntimeCache';
import { TextMeshCache } from '../assets/TextMeshCache';
import shaderSource from '../shaders/MeshPass.wgsl?raw';

export type SceneMeshLayer = ScenePrimitiveLayer | SceneText3DLayer | SceneModelLayer;
export type SceneNativeMeshLayer = ScenePrimitiveLayer | SceneText3DLayer | SceneModelLayer;

interface PrimitiveGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  edgeIndices: Uint32Array;
}

interface PrimitiveGpuResources {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  edgeIndexBuffer: GPUBuffer;
  edgeIndexCount: number;
  baseColor?: readonly [number, number, number, number];
}

const MESH_UNIFORM_SIZE = 144;
const DEFAULT_MESH_COLOR = [0.6667, 0.6667, 0.6667, 1] as const;
const WIREFRAME_COLOR = [0.2667, 0.5333, 1, 1] as const;

export class MeshPass {
  private meshPipelineOpaque: GPURenderPipeline | null = null;
  private meshPipelineTransparent: GPURenderPipeline | null = null;
  private meshPipelineWireframe: GPURenderPipeline | null = null;
  private meshBindGroupLayout: GPUBindGroupLayout | null = null;
  private primitiveCache = new Map<ScenePrimitiveLayer['meshType'], PrimitiveGpuResources>();
  private textCache = new Map<string, PrimitiveGpuResources>();
  private modelCache = new Map<string, PrimitiveGpuResources[]>();
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

    this.meshBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'native-scene-mesh-bind-group-layout',
    });

    const shaderModule = device.createShaderModule({
      code: shaderSource,
      label: 'native-scene-mesh-shader',
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.meshBindGroupLayout],
      label: 'native-scene-mesh-pipeline-layout',
    });

    const vertex: GPUVertexState = {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    };

    const fragmentTarget: GPUColorTargetState = {
      format: 'rgba8unorm',
    };

    this.meshPipelineOpaque = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex,
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [fragmentTarget],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      label: 'native-scene-mesh-opaque-pipeline',
    });

    this.meshPipelineTransparent = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex,
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          ...fragmentTarget,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      label: 'native-scene-mesh-transparent-pipeline',
    });

    this.meshPipelineWireframe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex,
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          ...fragmentTarget,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
      primitive: {
        topology: 'line-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      label: 'native-scene-mesh-wireframe-pipeline',
    });
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
      !this.meshBindGroupLayout
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

      const modelMatrix = this.resolveModelMatrix(layer, effectors);
      const mvp = this.multiplyMat4(
        this.multiplyMat4(camera.projectionMatrix, camera.viewMatrix),
        modelMatrix,
      );

      for (let resourceIndex = 0; resourceIndex < resourcesList.length; resourceIndex += 1) {
        const resources = resourcesList[resourceIndex]!;
        const color = this.resolveLayerColor(layer, resources.baseColor);
        const uniformBuffer = device.createBuffer({
          size: MESH_UNIFORM_SIZE,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `native-scene-mesh-uniform-${layer.layerId}-${resourceIndex}`,
        });
        temporaryBuffers.push(uniformBuffer);
        const uniformData = this.buildUniformData(mvp, modelMatrix, color, layer.opacity);
        device.queue.writeBuffer(
          uniformBuffer,
          0,
          uniformData.buffer,
          uniformData.byteOffset,
          uniformData.byteLength,
        );

        const bindGroup = device.createBindGroup({
          layout: this.meshBindGroupLayout,
          entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
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
    for (const resources of this.primitiveCache.values()) {
      resources.vertexBuffer.destroy();
      resources.indexBuffer.destroy();
      resources.edgeIndexBuffer.destroy();
    }
    this.primitiveCache.clear();
    for (const resources of this.textCache.values()) {
      resources.vertexBuffer.destroy();
      resources.indexBuffer.destroy();
      resources.edgeIndexBuffer.destroy();
    }
    this.textCache.clear();
    for (const resourcesList of this.modelCache.values()) {
      for (const resources of resourcesList) {
        resources.vertexBuffer.destroy();
        resources.indexBuffer.destroy();
        resources.edgeIndexBuffer.destroy();
      }
    }
    this.modelCache.clear();
    this.textMeshCache.clear();
  }

  pruneModelCache(activeModelUrls: Set<string>): void {
    for (const [modelUrl, resourcesList] of this.modelCache) {
      if (activeModelUrls.has(modelUrl)) {
        continue;
      }
      for (const resources of resourcesList) {
        resources.vertexBuffer.destroy();
        resources.indexBuffer.destroy();
        resources.edgeIndexBuffer.destroy();
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

      const geometry = this.createPrimitiveGeometry(layer.meshType);
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
        edgeIndices: this.buildEdgeIndices(primitive.indices),
      },
      `native-scene-model-${layer.layerId}-${primitiveIndex}`,
      primitive.baseColor,
    ));
    this.modelCache.set(layer.modelUrl, resourcesList);
    return resourcesList;
  }

  private createGpuResources(
    device: GPUDevice,
    geometry: PrimitiveGeometryData,
    label: string,
    baseColor?: readonly [number, number, number, number],
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

    return {
      vertexBuffer,
      indexBuffer,
      indexCount: geometry.indices.length,
      edgeIndexBuffer,
      edgeIndexCount: geometry.edgeIndices.length,
      ...(baseColor ? { baseColor } : {}),
    };
  }

  private resolveModelMatrix(
    layer: SceneNativeMeshLayer,
    effectors: SceneSplatEffectorRuntimeData[],
  ): Float32Array {
    if (!layer.worldTransform || effectors.length === 0) {
      return layer.worldMatrix;
    }

    const effected = applySceneEffectorsToObjectTransform({
      position: layer.worldTransform.position,
      rotation: layer.worldTransform.rotationRadians,
      scale: layer.worldTransform.scale,
    }, effectors, layer.layerId);
    return this.buildWorldMatrix({
      position: effected.position,
      rotationRadians: effected.rotation,
      rotationDegrees: {
        x: effected.rotation.x * (180 / Math.PI),
        y: effected.rotation.y * (180 / Math.PI),
        z: effected.rotation.z * (180 / Math.PI),
      },
      scale: effected.scale,
    });
  }

  private resolveLayerColor(
    layer: SceneNativeMeshLayer,
    modelBaseColor?: readonly [number, number, number, number],
  ): readonly [number, number, number, number] {
    if (layer.wireframe === true) {
      return WIREFRAME_COLOR;
    }
    if (layer.kind === 'text3d') {
      return this.parseColor(layer.text3DProperties?.color);
    }
    if (layer.kind === 'model' && modelBaseColor) {
      return modelBaseColor;
    }
    return DEFAULT_MESH_COLOR;
  }

  private parseColor(color: string | undefined): readonly [number, number, number, number] {
    if (!color) {
      return DEFAULT_MESH_COLOR;
    }

    const normalized = color.trim();
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      return [r, g, b, 1];
    }

    if (/^[0-9a-f]{6}$/i.test(hex)) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return [r, g, b, 1];
    }

    const rgbaMatch = normalized.match(
      /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
    );
    if (rgbaMatch) {
      const r = Math.max(0, Math.min(255, Number(rgbaMatch[1] ?? 255))) / 255;
      const g = Math.max(0, Math.min(255, Number(rgbaMatch[2] ?? 255))) / 255;
      const b = Math.max(0, Math.min(255, Number(rgbaMatch[3] ?? 255))) / 255;
      const a = Math.max(0, Math.min(1, Number(rgbaMatch[4] ?? 1)));
      return [r, g, b, a];
    }

    return DEFAULT_MESH_COLOR;
  }

  private buildUniformData(
    mvp: Float32Array,
    world: Float32Array,
    color: readonly [number, number, number, number],
    opacity: number,
  ): Float32Array {
    const data = new Float32Array(MESH_UNIFORM_SIZE / 4);
    data.set(mvp, 0);
    data.set(world, 16);
    data[32] = color[0];
    data[33] = color[1];
    data[34] = color[2];
    data[35] = color[3] * opacity;
    return data;
  }

  private createPrimitiveGeometry(meshType: ScenePrimitiveLayer['meshType']): PrimitiveGeometryData | null {
    switch (meshType) {
      case 'cube':
        return this.createBoxGeometry(0.6, 0.6, 0.6);
      case 'sphere':
        return this.createSphereGeometry(0.35, 32, 24);
      case 'plane':
        return this.createPlaneGeometry(0.8, 0.8);
      case 'cylinder':
        return this.createCylinderGeometry(0.25, 0.25, 0.6, 32);
      case 'torus':
        return this.createTorusGeometry(0.3, 0.1, 16, 48);
      case 'cone':
        return this.createCylinderGeometry(0, 0.3, 0.6, 32);
      default:
        return null;
    }
  }

  private createBoxGeometry(width: number, height: number, depth: number): PrimitiveGeometryData {
    const hw = width * 0.5;
    const hh = height * 0.5;
    const hd = depth * 0.5;
    const positions = [
      [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
      [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd],
      [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd],
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd],
      [hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd],
      [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd],
    ];
    const normals = [
      [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1],
      [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1],
      [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0],
      [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0],
      [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0],
      [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0],
    ];
    const indices = new Uint32Array([
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11,
      12, 13, 14, 12, 14, 15,
      16, 17, 18, 16, 18, 19,
      20, 21, 22, 20, 22, 23,
    ]);
    return this.buildGeometryData(positions, normals, indices);
  }

  private createPlaneGeometry(width: number, height: number): PrimitiveGeometryData {
    const hw = width * 0.5;
    const hh = height * 0.5;
    const positions = [
      [-hw, -hh, 0],
      [hw, -hh, 0],
      [hw, hh, 0],
      [-hw, hh, 0],
    ];
    const normals = [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ];
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    return this.buildGeometryData(positions, normals, indices);
  }

  private createSphereGeometry(radius: number, widthSegments: number, heightSegments: number): PrimitiveGeometryData {
    const positions: number[][] = [];
    const normals: number[][] = [];
    const indices: number[] = [];

    for (let y = 0; y <= heightSegments; y += 1) {
      const v = y / heightSegments;
      const phi = v * Math.PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      for (let x = 0; x <= widthSegments; x += 1) {
        const u = x / widthSegments;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const nx = sinPhi * cosTheta;
        const ny = cosPhi;
        const nz = sinPhi * sinTheta;
        positions.push([radius * nx, radius * ny, radius * nz]);
        normals.push([nx, ny, nz]);
      }
    }

    for (let y = 0; y < heightSegments; y += 1) {
      for (let x = 0; x < widthSegments; x += 1) {
        const a = y * (widthSegments + 1) + x;
        const b = a + widthSegments + 1;
        if (y !== 0) {
          indices.push(a, b, a + 1);
        }
        if (y !== heightSegments - 1) {
          indices.push(a + 1, b, b + 1);
        }
      }
    }

    return this.buildGeometryData(positions, normals, new Uint32Array(indices));
  }

  private createCylinderGeometry(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
  ): PrimitiveGeometryData {
    const positions: number[][] = [];
    const normals: number[][] = [];
    const indices: number[] = [];
    const halfHeight = height * 0.5;
    const slope = (radiusBottom - radiusTop) / Math.max(height, 0.0001);

    for (let i = 0; i <= radialSegments; i += 1) {
      const u = i / radialSegments;
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const sideNormal = this.normalize([sinTheta, slope, cosTheta]);
      positions.push([radiusTop * sinTheta, halfHeight, radiusTop * cosTheta]);
      normals.push(sideNormal);
      positions.push([radiusBottom * sinTheta, -halfHeight, radiusBottom * cosTheta]);
      normals.push(sideNormal);
    }

    for (let i = 0; i < radialSegments; i += 1) {
      const topA = i * 2;
      const bottomA = topA + 1;
      const topB = topA + 2;
      const bottomB = topA + 3;
      indices.push(topA, bottomA, topB);
      indices.push(topB, bottomA, bottomB);
    }

    const addCap = (top: boolean, radius: number) => {
      if (radius <= 0) {
        return;
      }
      const start = positions.length;
      const y = top ? halfHeight : -halfHeight;
      const normal = top ? [0, 1, 0] : [0, -1, 0];
      positions.push([0, y, 0]);
      normals.push(normal);
      for (let i = 0; i <= radialSegments; i += 1) {
        const u = i / radialSegments;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        positions.push([radius * sinTheta, y, radius * cosTheta]);
        normals.push(normal);
      }
      for (let i = 0; i < radialSegments; i += 1) {
        const center = start;
        const a = start + i + 1;
        const b = start + i + 2;
        if (top) {
          indices.push(center, a, b);
        } else {
          indices.push(center, b, a);
        }
      }
    };

    addCap(true, radiusTop);
    addCap(false, radiusBottom);

    return this.buildGeometryData(positions, normals, new Uint32Array(indices));
  }

  private createTorusGeometry(
    radius: number,
    tube: number,
    radialSegments: number,
    tubularSegments: number,
  ): PrimitiveGeometryData {
    const positions: number[][] = [];
    const normals: number[][] = [];
    const indices: number[] = [];

    for (let j = 0; j <= radialSegments; j += 1) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      for (let i = 0; i <= tubularSegments; i += 1) {
        const u = (i / tubularSegments) * Math.PI * 2;
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);
        const x = (radius + tube * cosV) * cosU;
        const y = tube * sinV;
        const z = (radius + tube * cosV) * sinU;
        positions.push([x, y, z]);
        normals.push([cosV * cosU, sinV, cosV * sinU]);
      }
    }

    for (let j = 1; j <= radialSegments; j += 1) {
      for (let i = 1; i <= tubularSegments; i += 1) {
        const a = (tubularSegments + 1) * j + i - 1;
        const b = (tubularSegments + 1) * (j - 1) + i - 1;
        const c = (tubularSegments + 1) * (j - 1) + i;
        const d = (tubularSegments + 1) * j + i;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    return this.buildGeometryData(positions, normals, new Uint32Array(indices));
  }

  private buildGeometryData(
    positions: number[][],
    normals: number[][],
    indices: Uint32Array,
  ): PrimitiveGeometryData {
    const vertices = new Float32Array(positions.length * 6);
    for (let i = 0; i < positions.length; i += 1) {
      const vertexOffset = i * 6;
      const position = positions[i];
      const normal = normals[i];
      vertices[vertexOffset + 0] = position?.[0] ?? 0;
      vertices[vertexOffset + 1] = position?.[1] ?? 0;
      vertices[vertexOffset + 2] = position?.[2] ?? 0;
      vertices[vertexOffset + 3] = normal?.[0] ?? 0;
      vertices[vertexOffset + 4] = normal?.[1] ?? 0;
      vertices[vertexOffset + 5] = normal?.[2] ?? 1;
    }

    const edgeIndices = this.buildEdgeIndices(indices);
    return { vertices, indices, edgeIndices };
  }

  private buildEdgeIndices(indices: Uint32Array): Uint32Array {
    const edges = new Set<string>();
    const result: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = triangle[edge];
        const b = triangle[(edge + 1) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (edges.has(key)) {
          continue;
        }
        edges.add(key);
        result.push(a, b);
      }
    }
    return new Uint32Array(result);
  }

  private buildWorldMatrix(transform: SceneWorldTransform): Float32Array {
    const x = transform.rotationRadians.x;
    const y = transform.rotationRadians.y;
    const z = transform.rotationRadians.z;
    const a = Math.cos(x);
    const b = Math.sin(x);
    const c = Math.cos(y);
    const d = Math.sin(y);
    const e = Math.cos(z);
    const f = Math.sin(z);
    const ae = a * e;
    const af = a * f;
    const be = b * e;
    const bf = b * f;
    const sx = transform.scale.x;
    const sy = transform.scale.y;
    const sz = transform.scale.z;

    const matrix = new Float32Array(16);
    matrix[0] = c * e * sx;
    matrix[1] = (af + be * d) * sx;
    matrix[2] = (bf - ae * d) * sx;
    matrix[3] = 0;
    matrix[4] = -c * f * sy;
    matrix[5] = (ae - bf * d) * sy;
    matrix[6] = (be + af * d) * sy;
    matrix[7] = 0;
    matrix[8] = d * sz;
    matrix[9] = -b * c * sz;
    matrix[10] = a * c * sz;
    matrix[11] = 0;
    matrix[12] = transform.position.x;
    matrix[13] = transform.position.y;
    matrix[14] = transform.position.z;
    matrix[15] = 1;
    return matrix;
  }

  private multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) {
          sum += a[k * 4 + row] * b[col * 4 + k];
        }
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }

  private normalize(vector: [number, number, number]): [number, number, number] {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }
}
