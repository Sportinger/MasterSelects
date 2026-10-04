import commonSource from './PtCommon.wgsl?raw';
import sceneBindingsSource from './PtSceneBindings.wgsl?raw';
import { PT_FRAME, PT_LIGHT, PT_MATERIAL, PT_MAX_LIGHTS, PT_MAX_MATERIALS } from './ptLayouts';

/**
 * Bind group conventions of the path tracer. Groups 0-2 are identical for every pipeline that
 * reads the scene, so one set of bind groups per frame serves all passes; group 3 is per pass.
 * At most 8 storage buffers per stage (the WebGPU default): 5 in group 1, up to 3 in group 3.
 */
export const PT_GROUP = { frame: 0, scene: 1, lightsMaterials: 2, outputs: 3 } as const;
export const PT_SCENE_STORAGE_BUFFERS = 5;
export const PT_MAX_PASS_STORAGE_BUFFERS = 3;

export const PT_FRAME_BYTES = PT_FRAME.size;
export const PT_LIGHTS_BYTES = PT_LIGHT.size * PT_MAX_LIGHTS;
export const PT_MATERIALS_BYTES = PT_MATERIAL.size * PT_MAX_MATERIALS;

export const PT_COMMON_WGSL = commonSource;
export const PT_SCENE_BINDINGS_WGSL = sceneBindingsSource;

export interface PtSceneLayouts { frame: GPUBindGroupLayout; scene: GPUBindGroupLayout; lightsMaterials: GPUBindGroupLayout }

const layoutCache = new WeakMap<GPUDevice, PtSceneLayouts>();

/** The shared layouts of groups 0-2 on `device`. */
export function ptSceneLayouts(device: GPUDevice): PtSceneLayouts {
  const cached = layoutCache.get(device);
  if (cached) return cached;
  const visibility = GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT;
  const storage = (binding: number): GPUBindGroupLayoutEntry =>
    ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } });
  const layouts: PtSceneLayouts = {
    frame: device.createBindGroupLayout({ label: 'pt-frame', entries: [
      { binding: 0, visibility, buffer: { type: 'uniform', minBindingSize: PT_FRAME_BYTES } },
      { binding: 1, visibility, texture: { sampleType: 'unfilterable-float' } },
    ] }),
    scene: device.createBindGroupLayout({ label: 'pt-scene', entries: [0, 1, 2, 3, 4].map(storage) }),
    lightsMaterials: device.createBindGroupLayout({ label: 'pt-lights-materials', entries: [
      { binding: 0, visibility, buffer: { type: 'uniform', minBindingSize: PT_LIGHTS_BYTES } },
      { binding: 1, visibility, buffer: { type: 'uniform', minBindingSize: PT_MATERIALS_BYTES } },
      { binding: 2, visibility, texture: { sampleType: 'float' } },
      { binding: 3, visibility, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility, sampler: { type: 'filtering' } },
    ] }),
  };
  layoutCache.set(device, layouts);
  return layouts;
}

/** The fixed WGSL interfaces; `composePtShader` refuses a module that calls one without defining it. */
export const PT_INTERFACES = {
  pt_trace_closest: 'fn pt_trace_closest(ray: PtRay) -> PtHit',
  pt_trace_transmittance: 'fn pt_trace_transmittance(ray: PtRay, tMax: f32) -> f32',
  pt_bsdf_eval: 'fn pt_bsdf_eval(s: PtSurface, wo: vec3f, wi: vec3f) -> vec3f',
  pt_bsdf_sample: 'fn pt_bsdf_sample(s: PtSurface, wo: vec3f, u: vec3f) -> PtBsdfSample',
  pt_bsdf_pdf: 'fn pt_bsdf_pdf(s: PtSurface, wo: vec3f, wi: vec3f) -> f32',
  pt_sample_light: 'fn pt_sample_light(p: vec3f, n: vec3f, u: vec3f) -> PtLightSample',
  pt_cache_query: 'fn pt_cache_query(p: vec3f, n: vec3f, spread: f32) -> vec4f',
  pt_cache_update: 'fn pt_cache_update(p: vec3f, n: vec3f, spread: f32, radiance: vec3f)',
} as const;
export type PtInterfaceName = keyof typeof PT_INTERFACES;

const normalizeSignature = (value: string) => value.replace(/\s+/g, ' ').replace(/\s*([(),:<>-])\s*/g, '$1').trim();

/**
 * Joins WGSL modules in order. Every fixed interface that the result calls must be defined exactly
 * once with its contract signature, so modules built against the contract compose without surprises.
 */
export function composePtShader(label: string, modules: readonly string[]): string {
  const code = modules.join('\n');
  const source = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [name, signature] of Object.entries(PT_INTERFACES)) {
    const definitions = [...source.matchAll(new RegExp(`fn\\s+${name}\\s*\\([^)]*\\)\\s*(->\\s*[\\w<>]+)?`, 'g'))];
    const called = new RegExp(`\\b${name}\\s*\\(`).test(source.replace(new RegExp(`fn\\s+${name}\\s*\\(`, 'g'), ''));
    if (definitions.length > 1) throw new Error(`${label}: ${name} is defined twice`);
    if (definitions.length === 1 && normalizeSignature(definitions[0][0]) !== normalizeSignature(signature)) {
      throw new Error(`${label}: ${name} does not match its contract "${signature}"`);
    }
    if (called && !definitions.length) throw new Error(`${label}: calls ${name} without a module that defines it`);
  }
  return code;
}
