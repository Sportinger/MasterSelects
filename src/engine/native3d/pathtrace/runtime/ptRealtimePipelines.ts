import pathCommonSource from '../integrator/PtPathCommon.wgsl?raw';
import realtimeSource from '../integrator/PtRealtimeIntegrator.wgsl?raw';
import sharcSource from '../cache/PtSharc.wgsl?raw';
import sharcResolveSource from '../cache/PtSharcResolve.wgsl?raw';
import restirSource from '../restir/PtRestir.wgsl?raw';
import restirShadeSource from '../restir/PtRestirShade.wgsl?raw';
import svgfSource from '../denoise/PtSvgf.wgsl?raw';
import atrousSource from '../denoise/PtAtrous.wgsl?raw';
import upscaleSource from '../denoise/PtUpscale.wgsl?raw';
import { composePtShader, ptSceneLayouts } from '../contracts/ptBindings';
import { ptComputePipeline, ptShaderModule } from '../ptCompute';
import { PT_SCENE_MODULES } from './ptPipelines';

/** Pipelines of the realtime path: integrator, ReSTIR shading, cache resolve, SVGF, à-trous, upscaler. */
export interface PtRealtimePipelines {
  integratorOutputs: GPUBindGroupLayout;
  integrator: GPUComputePipeline;
  restirOutputs: GPUBindGroupLayout;
  restir: GPUComputePipeline;
  sharcLayout: GPUBindGroupLayout;
  sharcResolve: GPUComputePipeline;
  svgfLayout: GPUBindGroupLayout;
  svgf: GPUComputePipeline;
  atrousLayout: GPUBindGroupLayout;
  atrous: GPUComputePipeline;
  upscaleLayout: GPUBindGroupLayout;
  upscale: GPUComputePipeline;
}

const cache = new WeakMap<GPUDevice, PtRealtimePipelines>();

type Entry = 'read' | 'write' | 'uniform' | 'band';

function layout(device: GPUDevice, label: string, entries: Entry[]): GPUBindGroupLayout {
  return device.createBindGroupLayout({ label, entries: entries.map((kind, binding): GPUBindGroupLayoutEntry => ({
    binding, visibility: GPUShaderStage.COMPUTE,
    buffer: kind === 'read' ? { type: 'read-only-storage' } : kind === 'write' ? { type: 'storage' }
      : kind === 'band' ? { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } : { type: 'uniform' },
  })) });
}

export function ptRealtimePipelines(device: GPUDevice): PtRealtimePipelines {
  const cached = cache.get(device);
  if (cached) return cached;
  const scene = ptSceneLayouts(device);
  const sceneLayout = (outputs: GPUBindGroupLayout) => device.createPipelineLayout({
    bindGroupLayouts: [scene.frame, scene.scene, scene.lightsMaterials, outputs] });
  const compute = (label: string, code: string, entry: string, pipelineLayout: GPUPipelineLayout) =>
    ptComputePipeline(device, label, ptShaderModule(device, label, code), entry, pipelineLayout);
  const single = (group: GPUBindGroupLayout) => device.createPipelineLayout({ bindGroupLayouts: [group] });

  const integratorOutputs = layout(device, 'pt-realtime-outputs', ['write', 'write', 'write', 'band']);
  const integrator = compute('pt-realtime', composePtShader('pt-realtime', [...PT_SCENE_MODULES, pathCommonSource, sharcSource, restirSource,
    realtimeSource]), 'integrateRealtime', sceneLayout(integratorOutputs));
  const restirOutputs = layout(device, 'pt-restir-outputs', ['read', 'write', 'write', 'band']);
  const restir = compute('pt-restir', composePtShader('pt-restir', [...PT_SCENE_MODULES, pathCommonSource, restirSource, restirShadeSource]),
    'restirShade', sceneLayout(restirOutputs));
  const sharcLayout = layout(device, 'pt-sharc-resolve', ['write', 'uniform']);
  const sharcResolve = compute('pt-sharc-resolve', sharcResolveSource, 'resolveSharc', single(sharcLayout));
  const svgfLayout = layout(device, 'pt-svgf', ['read', 'read', 'read', 'read', 'write', 'write', 'uniform']);
  const svgf = compute('pt-svgf', svgfSource, 'svgfTemporal', single(svgfLayout));
  const atrousLayout = layout(device, 'pt-atrous', ['read', 'read', 'write', 'uniform']);
  const atrous = compute('pt-atrous', atrousSource, 'atrous', single(atrousLayout));
  const upscaleLayout = layout(device, 'pt-upscale', ['read', 'read', 'read', 'write', 'write', 'uniform']);
  const upscale = compute('pt-upscale', upscaleSource, 'upscale', single(upscaleLayout));
  const pipelines = { integratorOutputs, integrator, restirOutputs, restir, sharcLayout, sharcResolve, svgfLayout, svgf, atrousLayout, atrous,
    upscaleLayout, upscale };
  cache.set(device, pipelines);
  return pipelines;
}
