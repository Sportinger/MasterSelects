import compositeShaderSource from '../shaders/SceneTextureComposite.wgsl?raw';
import planeShaderSource from '../shaders/PlanePass.wgsl?raw';
import {
  SCENE_COLOR_FORMAT,
  SCENE_DEPTH_FORMAT,
  SCENE_DISPLAY_FORMAT,
} from './constants';

/** Tone map pass from the HDR scene target into the compositor's 8-bit scene texture. */
export interface CompositeResources {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  /** Unused by the tone map (it loads texels 1:1); kept for callers that sample scene textures. */
  sampler: GPUSampler;
}

export interface PlaneResources {
  opaquePipeline: GPURenderPipeline;
  transparentPipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
}

export interface PlaneWhiteMaskResource {
  whiteMaskTexture: GPUTexture;
  whiteMaskView: GPUTextureView;
}

export function createCompositeResources(device: GPUDevice): CompositeResources {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
    label: 'native-scene-tone-map-bind-group-layout',
  });
  const shaderModule = device.createShaderModule({ code: compositeShaderSource, label: 'native-scene-tone-map-shader' });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout], label: 'native-scene-tone-map-pipeline-layout' }),
    vertex: { module: shaderModule, entryPoint: 'vertexMain' },
    fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format: SCENE_DISPLAY_FORMAT }] },
    primitive: { topology: 'triangle-list' },
    label: 'native-scene-tone-map-pipeline',
  });
  return { pipeline, bindGroupLayout, sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) };
}

export function createPlaneResources(device: GPUDevice): PlaneResources {
  const bindGroupLayout = device.createBindGroupLayout({
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
    bindGroupLayouts: [bindGroupLayout],
    label: 'native-scene-plane-pipeline-layout',
  });

  const opaquePipeline = device.createRenderPipeline({
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
          format: SCENE_COLOR_FORMAT,
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

  const transparentPipeline = device.createRenderPipeline({
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
          format: SCENE_COLOR_FORMAT,
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

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  return {
    opaquePipeline,
    transparentPipeline,
    bindGroupLayout,
    sampler,
  };
}

export function createPlaneWhiteMaskResource(device: GPUDevice): PlaneWhiteMaskResource {
  const whiteMaskTexture = device.createTexture({
    size: { width: 1, height: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
    label: 'native-scene-plane-white-mask-texture',
  });

  return {
    whiteMaskTexture,
    whiteMaskView: whiteMaskTexture.createView(),
  };
}
