import shaderSource from '../../shaders/gaussianSplat.wgsl?raw';

const SPLAT_DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export interface SplatRenderPipelineBundle {
  splatDataBindGroupLayout: GPUBindGroupLayout;
  cameraBindGroupLayout: GPUBindGroupLayout;
  pipeline: GPURenderPipeline;
  pipelineWithDepth: GPURenderPipeline;
  pipelineWithDepthWrite: GPURenderPipeline;
  pipelineWithDepthWriteMask: GPURenderPipeline;
}

/** `format`: color target of the passes (the shared native scene renders in HDR, standalone targets in 8 bit). */
export function createSplatRenderPipelines(device: GPUDevice, format: GPUTextureFormat = 'rgba8unorm'): SplatRenderPipelineBundle {
  const shaderModule = device.createShaderModule({
    code: shaderSource,
    label: 'gaussian-splat-shader',
  });

  const splatDataBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
    ],
    label: 'splat-data-bind-group-layout',
  });

  const cameraBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
    label: 'splat-camera-bind-group-layout',
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [splatDataBindGroupLayout, cameraBindGroupLayout],
    label: 'gaussian-splat-pipeline-layout',
  });

  return {
    splatDataBindGroupLayout,
    cameraBindGroupLayout,
    pipeline: createColorPipeline(device, pipelineLayout, shaderModule, format, 'gaussian-splat-render-pipeline'),
    pipelineWithDepth: createColorPipeline(
      device,
      pipelineLayout,
      shaderModule,
      format,
      'gaussian-splat-depth-tested-render-pipeline',
      false,
    ),
    pipelineWithDepthWrite: createColorPipeline(
      device,
      pipelineLayout,
      shaderModule,
      format,
      'gaussian-splat-depth-writing-render-pipeline',
      true,
    ),
    pipelineWithDepthWriteMask: createDepthMaskPipeline(
      device,
      pipelineLayout,
      shaderModule,
      format,
      'gaussian-splat-depth-mask-render-pipeline',
    ),
  };
}

const formatBundles = new WeakMap<GPUDevice, Map<GPUTextureFormat, SplatRenderPipelineBundle>>();

/**
 * Pipelines for an output format other than the default 8-bit one (the HDR native scene). Layouts
 * with identical entries are group-equivalent, so bind groups made with the default bundle stay valid.
 */
export function splatPipelinesForFormat(device: GPUDevice, format: GPUTextureFormat): SplatRenderPipelineBundle {
  let bundles = formatBundles.get(device);
  if (!bundles) { bundles = new Map(); formatBundles.set(device, bundles); }
  let bundle = bundles.get(format);
  if (!bundle) { bundle = createSplatRenderPipelines(device, format); bundles.set(format, bundle); }
  return bundle;
}

function createColorPipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  shaderModule: GPUShaderModule,
  format: GPUTextureFormat,
  label: string,
  depthWriteEnabled?: boolean,
): GPURenderPipeline {
  const descriptor: GPURenderPipelineDescriptor = {
    layout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [buildBlendedColorTarget(format)],
    },
    primitive: {
      topology: 'triangle-strip',
      stripIndexFormat: undefined,
    },
    label,
  };

  if (depthWriteEnabled !== undefined) {
    descriptor.depthStencil = {
      format: SPLAT_DEPTH_FORMAT,
      depthWriteEnabled,
      depthCompare: 'less-equal',
    };
  }

  return device.createRenderPipeline(descriptor);
}

function createDepthMaskPipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  shaderModule: GPUShaderModule,
  format: GPUTextureFormat,
  label: string,
): GPURenderPipeline {
  return device.createRenderPipeline({
    layout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          writeMask: 0,
        },
      ],
    },
    primitive: {
      topology: 'triangle-strip',
      stripIndexFormat: undefined,
    },
    depthStencil: {
      format: SPLAT_DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    },
    label,
  });
}

function buildBlendedColorTarget(format: GPUTextureFormat): GPUColorTargetState {
  return {
    format,
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
  };
}
