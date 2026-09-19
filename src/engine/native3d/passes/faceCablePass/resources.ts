import shader from '../../shaders/FaceCableScene.wgsl?raw';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../../sceneRenderer/constants';
import { Logger } from '../../../../services/logger';

export const CABLE_SCENE_UNIFORM_FLOATS = 32 + 4 * 32 + 4 + 400;
export const CABLE_SCENE_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 48, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32x3' },
    { shaderLocation: 4, offset: 44, format: 'float32' },
  ],
};
export function createCableSceneResources(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
  ] });
  const module = device.createShaderModule({ code: shader, label: 'native-face-cables' });
  void module.getCompilationInfo?.().then(info => {
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) Logger.create('FaceCablePass').error('Scene shader compilation failed', errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`));
  });
  const pipeline = device.createRenderPipeline({ label: 'native-face-cables',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'mainVertex', buffers: [CABLE_SCENE_VERTEX_LAYOUT] },
    fragment: { module, entryPoint: 'mainFragment', targets: [{ format: SCENE_COLOR_FORMAT,
      blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
  });
  const shadowLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
  const shadowModule = device.createShaderModule({ code: '@group(0) @binding(0) var<uniform> mvp: mat4x4f; @vertex fn main(@location(0) p: vec3f) -> @builtin(position) vec4f { return mvp * vec4f(p, 1); }' });
  const shadowPipeline = device.createRenderPipeline({ label: 'native-cable-shadow-map', layout: device.createPipelineLayout({ bindGroupLayouts: [shadowLayout] }),
    vertex: { module: shadowModule, entryPoint: 'main', buffers: [{ arrayStride: 48, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 1, depthBiasSlopeScale: 1 },
  });
  return { pipeline, layout, shadowPipeline, shadowLayout,
    sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
    shadowSampler: device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' }) };
}
