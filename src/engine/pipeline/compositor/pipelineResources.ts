import compositeShader from '../../../shaders/compositeShader';
import {
  COPY_SHADER,
  EXTERNAL_COPY_90_SHADER,
  EXTERNAL_COPY_180_SHADER,
  EXTERNAL_COPY_270_SHADER,
  EXTERNAL_COPY_SHADER,
} from './copyShaders';
import type { VideoRotationDegrees } from '../../webcodecs/videoTrackOrientation';
import { EXTERNAL_COMPOSITE_SHADER } from './externalCompositeShader';

export interface CompositorPipelineResources {
  compositePipeline: GPURenderPipeline;
  externalCompositePipeline: GPURenderPipeline;
  copyPipeline: GPURenderPipeline;
  externalCopyPipeline: GPURenderPipeline;
  externalCopyPipelines: ReadonlyMap<VideoRotationDegrees, GPURenderPipeline>;
  compositeBindGroupLayout: GPUBindGroupLayout;
  externalCompositeBindGroupLayout: GPUBindGroupLayout;
  copyBindGroupLayout: GPUBindGroupLayout;
  externalCopyBindGroupLayout: GPUBindGroupLayout;
}

export function createCompositorPipelineResources(device: GPUDevice): CompositorPipelineResources {
  // Composite bind group layout
  const compositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // Mask texture
    ],
  });

  // Composite pipeline
  const compositeModule = device.createShaderModule({ code: compositeShader });

  const compositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [compositeBindGroupLayout],
    }),
    vertex: { module: compositeModule, entryPoint: 'vertexMain' },
    fragment: {
      module: compositeModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // External composite pipeline (for direct video texture compositing - zero copy!)
  const externalCompositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // Mask texture
    ],
  });

  const externalCompositeModule = device.createShaderModule({ code: EXTERNAL_COMPOSITE_SHADER });

  const externalCompositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [externalCompositeBindGroupLayout],
    }),
    vertex: { module: externalCompositeModule, entryPoint: 'vertexMain' },
    fragment: {
      module: externalCompositeModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // Copy pipeline for regular textures (used for effect pre-processing)
  const copyBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });

  const copyModule = device.createShaderModule({ code: COPY_SHADER });

  const copyPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [copyBindGroupLayout],
    }),
    vertex: { module: copyModule, entryPoint: 'vertexMain' },
    fragment: {
      module: copyModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // External copy pipeline for video textures (used for effect pre-processing)
  const externalCopyBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
    ],
  });

  const externalCopyModule = device.createShaderModule({ code: EXTERNAL_COPY_SHADER });

  const externalCopyPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [externalCopyBindGroupLayout],
    }),
    vertex: { module: externalCopyModule, entryPoint: 'vertexMain' },
    fragment: {
      module: externalCopyModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const createRotatedExternalCopyPipeline = (code: string): GPURenderPipeline => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [externalCopyBindGroupLayout],
      }),
      vertex: {
        module,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  };

  const externalCopyPipelines = new Map<VideoRotationDegrees, GPURenderPipeline>([
    [0, externalCopyPipeline],
    [90, createRotatedExternalCopyPipeline(EXTERNAL_COPY_90_SHADER)],
    [180, createRotatedExternalCopyPipeline(EXTERNAL_COPY_180_SHADER)],
    [270, createRotatedExternalCopyPipeline(EXTERNAL_COPY_270_SHADER)],
  ]);

  return {
    compositePipeline,
    externalCompositePipeline,
    copyPipeline,
    externalCopyPipeline,
    externalCopyPipelines,
    compositeBindGroupLayout,
    externalCompositeBindGroupLayout,
    copyBindGroupLayout,
    externalCopyBindGroupLayout,
  };
}
