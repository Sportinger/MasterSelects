import { nodeScalarSampleTap } from '../../../services/nodePreview/NodeScalarSampleTap';
import type { SceneCamera, SceneLayer3DData, SceneVoxelLayer } from '../../scene/types';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import voxelShaderSource from '../shaders/VoxelPass.wgsl?raw';
import scalarFieldShader from '../../../shaders/scalarField.wgsl?raw';
import {
  buildVoxelUniformData,
  resolveVoxelGridDimensions,
  shouldRenderVoxelFloor,
  VOXEL_UNIFORM_SIZE,
} from './voxelPass/voxelUniforms';
import { createPrimitiveGeometry } from './meshPass/primitiveGeometry';
import { compileVoxelGraph } from '../../../services/operators/voxelGraph';

interface VoxelPrimitiveBuffers { vertex: GPUBuffer; index: GPUBuffer; indexCount: number }

export interface SceneVoxelRenderLayer {
  layer: SceneVoxelLayer;
  textureView: GPUTextureView;
}

export class VoxelPass {
  private cubePipeline: GPURenderPipeline | null = null;
  private floorPipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private primitiveBuffers = new Map<'box' | 'sphere' | 'cylinder', VoxelPrimitiveBuffers>();

  supports(layer: SceneLayer3DData): layer is SceneVoxelLayer {
    return layer.kind === 'voxel';
  }

  collect(layers: SceneLayer3DData[]): SceneVoxelLayer[] {
    return layers.filter((layer): layer is SceneVoxelLayer => this.supports(layer));
  }

  initialize(device: GPUDevice): void {
    if (this.cubePipeline && this.floorPipeline && this.bindGroupLayout) return;
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
      label: 'native-scene-voxel-bind-group-layout',
    });
    const module = device.createShaderModule({ code: scalarFieldShader + '\n' + voxelShaderSource, label: 'native-scene-voxel-shader' });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
      label: 'native-scene-voxel-pipeline-layout',
    });
    const base: Omit<GPURenderPipelineDescriptor, 'vertex' | 'label'> = {
      layout,
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: SCENE_COLOR_FORMAT,
        blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
      }] },
      // Scene convention: every native3d pipeline draws unculled (see
      // pipelineResources.ts / meshPass) because the projection's Y handling
      // flips winding; depth testing handles occlusion.
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: SCENE_DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
    };
    this.floorPipeline = device.createRenderPipeline({
      ...base,
      vertex: { module, entryPoint: 'floorVertexMain' },
      label: 'native-scene-voxel-floor-pipeline',
    });
    this.cubePipeline = device.createRenderPipeline({
      ...base,
      vertex: { module, entryPoint: 'voxelVertexMain', buffers: [{ arrayStride: 32, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ] }] },
      label: 'native-scene-voxel-cube-pipeline',
    });
  }

  render(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView,
    voxelLayers: SceneVoxelRenderLayer[],
    camera: SceneCamera,
    temporaryBuffers: GPUBuffer[],
  ): boolean {
    if (voxelLayers.length === 0) return true;
    this.initialize(device);
    if (!this.cubePipeline || !this.floorPipeline || !this.bindGroupLayout) return false;

    for (const { layer, textureView } of voxelLayers) if (nodeScalarSampleTap.has(`voxel-scene:${layer.clipId}`)) {
      nodeScalarSampleTap.capture(`voxel-scene:${layer.clipId}`, device, commandEncoder, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), textureView);
    }
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: {
        view: sceneDepthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
      label: 'native-scene-voxel-opaque-pass',
    });

    for (const { layer, textureView } of voxelLayers) {
      const grid = resolveVoxelGridDimensions(layer);
      const uniformBuffer = device.createBuffer({
        size: VOXEL_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `native-scene-voxel-uniform-${layer.layerId}`,
      });
      temporaryBuffers.push(uniformBuffer);
      const uniformData = buildVoxelUniformData(layer, camera, grid);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);
      const bindGroup = device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: textureView },
        ],
        label: `native-scene-voxel-bind-group-${layer.layerId}`,
      });
      renderPass.setBindGroup(0, bindGroup);
      if (shouldRenderVoxelFloor(layer)) {
        renderPass.setPipeline(this.floorPipeline);
        renderPass.draw(6);
      }
      const primitive = this.getPrimitiveBuffers(device, (layer.voxelGraphPlan ?? compileVoxelGraph(layer.voxelParams)).primitiveShape);
      renderPass.setPipeline(this.cubePipeline);
      renderPass.setVertexBuffer(0, primitive.vertex);
      renderPass.setIndexBuffer(primitive.index, 'uint32');
      renderPass.drawIndexed(primitive.indexCount, grid.columns * grid.rows);
    }
    renderPass.end();
    return true;
  }

  dispose(): void {
    this.cubePipeline = null;
    this.floorPipeline = null;
    this.bindGroupLayout = null;
    for (const buffers of this.primitiveBuffers.values()) { buffers.vertex.destroy(); buffers.index.destroy(); }
    this.primitiveBuffers.clear();
  }

  private getPrimitiveBuffers(device: GPUDevice, shape: 'box' | 'sphere' | 'cylinder'): VoxelPrimitiveBuffers {
    const cached = this.primitiveBuffers.get(shape); if (cached) return cached;
    const geometry = createPrimitiveGeometry(shape === 'box' ? 'cube' : shape)!;
    const vertexData = Float32Array.from(geometry.vertices), indexData = Uint32Array.from(geometry.indices);
    const vertex = device.createBuffer({ size: geometry.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: `voxel-${shape}-vertices` });
    const index = device.createBuffer({ size: geometry.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: `voxel-${shape}-indices` });
    device.queue.writeBuffer(vertex, 0, vertexData); device.queue.writeBuffer(index, 0, indexData);
    const result = { vertex, index, indexCount: geometry.indices.length }; this.primitiveBuffers.set(shape, result); return result;
  }
}
