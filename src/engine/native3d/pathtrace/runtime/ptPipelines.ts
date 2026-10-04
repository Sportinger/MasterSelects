import samplerSource from '../integrator/PtSampler.wgsl?raw';
import fiberBsdfSource from '../materials/PtFiberBsdf.wgsl?raw';
import bsdfSource from '../materials/PtBsdf.wgsl?raw';
import surfaceTextureSource from '../materials/PtSurfaceTexture.wgsl?raw';
import traverseSource from '../bvh/PtTraverse.wgsl?raw';
import lightsSource from '../lights/PtLights.wgsl?raw';
import shadingSource from '../integrator/PtShading.wgsl?raw';
import pathCommonSource from '../integrator/PtPathCommon.wgsl?raw';
import integratorSource from '../integrator/PtIntegrator.wgsl?raw';
import resolveSource from '../integrator/PtResolve.wgsl?raw';
import { composePtShader, PT_COMMON_WGSL, PT_SCENE_BINDINGS_WGSL, ptSceneLayouts, type PtSceneLayouts } from '../contracts/ptBindings';
import { ptComputePipeline, ptShaderModule } from '../ptCompute';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../../sceneRenderer/constants';

/** WGSL modules every scene-reading path tracing kernel composes, in dependency order. */
export const PT_SCENE_MODULES = [PT_COMMON_WGSL, PT_SCENE_BINDINGS_WGSL, samplerSource, fiberBsdfSource, bsdfSource, surfaceTextureSource,
  traverseSource, lightsSource, shadingSource];

export interface PtPipelines {
  scene: PtSceneLayouts;
  integratorOutputs: GPUBindGroupLayout;
  integrator: GPUComputePipeline;
  resolveLayout: GPUBindGroupLayout;
  resolve: GPURenderPipeline;
}

const cache = new WeakMap<GPUDevice, PtPipelines>();

export function ptPipelines(device: GPUDevice): PtPipelines {
  const cached = cache.get(device);
  if (cached) return cached;
  const scene = ptSceneLayouts(device);
  const storage = (binding: number, type: GPUBufferBindingType, visibility: number): GPUBindGroupLayoutEntry =>
    ({ binding, visibility, buffer: { type } });
  const integratorOutputs = device.createBindGroupLayout({ label: 'pt-integrator-outputs', entries: [
    ...[0, 1, 2].map(binding => storage(binding, 'storage', GPUShaderStage.COMPUTE)),
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
  const integratorCode = composePtShader('pt-integrator', [...PT_SCENE_MODULES, pathCommonSource, integratorSource]);
  const integrator = ptComputePipeline(device, 'pt-integrator', ptShaderModule(device, 'pt-integrator', integratorCode), 'integrate',
    device.createPipelineLayout({ bindGroupLayouts: [scene.frame, scene.scene, scene.lightsMaterials, integratorOutputs] }));
  const resolveLayout = device.createBindGroupLayout({ label: 'pt-resolve', entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ...[1, 2, 3, 4, 5, 6].map(binding => storage(binding, 'read-only-storage', GPUShaderStage.FRAGMENT)),
  ] });
  const resolveModule = ptShaderModule(device, 'pt-resolve', resolveSource);
  const resolve = device.createRenderPipeline({ label: 'pt-resolve', layout: device.createPipelineLayout({ bindGroupLayouts: [resolveLayout] }),
    vertex: { module: resolveModule, entryPoint: 'resolveVertex' },
    fragment: { module: resolveModule, entryPoint: 'resolveFragment', targets: [{ format: SCENE_COLOR_FORMAT }] },
    depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
    primitive: { topology: 'triangle-list' } });
  const pipelines = { scene, integratorOutputs, integrator, resolveLayout, resolve };
  cache.set(device, pipelines);
  return pipelines;
}
