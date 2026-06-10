import shaderSource from '../../shaders/MeshPass.wgsl?raw';

export interface MeshPipelineResources {
  opaquePipeline: GPURenderPipeline;
  transparentPipeline: GPURenderPipeline;
  wireframePipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
}

export function createMeshPipelineResources(
  device: GPUDevice,
  depthFormat: GPUTextureFormat,
): MeshPipelineResources {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
    ],
    label: 'native-scene-mesh-bind-group-layout',
  });
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    label: 'native-scene-mesh-sampler',
  });

  const shaderModule = device.createShaderModule({
    code: shaderSource,
    label: 'native-scene-mesh-shader',
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
    label: 'native-scene-mesh-pipeline-layout',
  });

  const vertex: GPUVertexState = {
    module: shaderModule,
    entryPoint: 'vertexMain',
    buffers: [
      {
        arrayStride: 32,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x2' },
        ],
      },
    ],
  };

  const fragmentTarget: GPUColorTargetState = {
    format: 'rgba8unorm',
  };

  const opaquePipeline = device.createRenderPipeline({
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

  const transparentPipeline = device.createRenderPipeline({
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

  const wireframePipeline = device.createRenderPipeline({
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

  return {
    opaquePipeline,
    transparentPipeline,
    wireframePipeline,
    bindGroupLayout,
    sampler,
  };
}
