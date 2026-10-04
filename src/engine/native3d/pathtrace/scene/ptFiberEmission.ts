import emissionSource from './PtFiberEmission.wgsl?raw';
import { STRAND_FIBER_GEOMETRY_SHADER } from '../../passes/strandShaders';
import { FLYAWAY_CHANNELS, worldMatrixScale, cameraPositionFromView } from '../../passes/StrandPass';
import type { StrandBuffers } from '../../passes/strandBuffers';
import type { SceneCamera, SceneStrandLayer } from '../../../scene/types';
import { PT_COMMON_WGSL } from '../contracts/ptBindings';
import { ptComputePipeline, ptDispatchShape, ptShaderModule, ptUniformBuffer } from '../ptCompute';

/** Linear pieces per curve segment when the Strand Render node sets no Subdivision. */
export const PT_DEFAULT_FIBER_SUBDIVISIONS = 2;
/** Preview level of detail switches only when the wanted fiber share leaves its level by this factor. */
const LOD_HYSTERESIS = 1.35;

/** Fiber instances per yarn: plies × fibers plus flyaway channels (one fiber without a Yarn Profile). */
export function ptFiberInstances(layer: SceneStrandLayer): number {
  const render = layer.strands.program.render!, profile = render.profile;
  return (profile ? profile.plies * profile.fibers : 1) + (profile && render.flyaways ? FLYAWAY_CHANNELS : 0);
}

export function ptFiberSubdivisions(layer: SceneStrandLayer): number {
  return Math.max(1, Math.min(16, Math.round(layer.strands.program.render?.subdivision ?? PT_DEFAULT_FIBER_SUBDIVISIONS)));
}

/** Output slots of a layer: fixed for its topology (curve segments, fibers, flyaways, subdivision). */
export function ptFiberSlots(layer: SceneStrandLayer, buffers: StrandBuffers): number {
  return buffers.segmentCount * ptFiberInstances(layer) * ptFiberSubdivisions(layer);
}

/** The yarn uniforms StrandPass uses (world, yarn, twist, flyaways), as StrandFiberParams. */
export function packStrandFiberParams(layer: SceneStrandLayer, target: Float32Array, offset = 0): void {
  const render = layer.strands.program.render!, profile = render.profile, flyaways = profile && render.flyaways;
  target.set(layer.worldMatrix, offset);
  target.set(profile ? [profile.plies, profile.fibers, profile.radius, profile.plyTwist] : [1, 1, 0, 0], offset + 16);
  target.set([profile ? profile.fiberTwist : 0, flyaways ? flyaways.seed : 0, 0, 0], offset + 20);
  if (flyaways) target.set([FLYAWAY_CHANNELS / flyaways.density, flyaways.length, flyaways.lift, flyaways.hair], offset + 24);
}

/**
 * Writes a strand layer's fibers into the path tracer's fiber page. Preview level of detail (a
 * power-of-two share of the fibers, chosen per layer from the projected fiber width at the layer's
 * nearest point, with hysteresis) changes the emitted fibers, so a change of level is a new topology.
 */
export class PtFiberEmitter {
  private readonly levels = new Map<string, number>();

  /** Kept share of fibers for `layer` in the preview; 1 for export and still convergence. */
  keepFraction(layer: SceneStrandLayer, buffers: StrandBuffers, camera: SceneCamera, lod: boolean): number {
    if (!lod) { this.levels.delete(layer.layerId); return 1; }
    const render = layer.strands.program.render!, scale = worldMatrixScale(layer.worldMatrix), world = layer.worldMatrix;
    const eye = cameraPositionFromView(camera.viewMatrix);
    const distance = Math.hypot(world[12] - eye[0], world[13] - eye[1], world[14] - eye[2]);
    const nearest = Math.max(distance - buffers.extent * scale, distance * 0.05, 1e-3);
    const pixels = render.width * scale * Math.abs(camera.projectionMatrix[5]) * camera.viewport.height * 0.5 / nearest;
    const wanted = Math.min(1, Math.max(pixels, 1 / ptFiberInstances(layer)));
    const current = this.levels.get(layer.layerId);
    let level = current ?? Math.min(1, 2 ** Math.ceil(Math.log2(wanted)));
    if (current !== undefined && (wanted > current * LOD_HYSTERESIS || wanted < current / (2 * LOD_HYSTERESIS))) {
      level = Math.min(1, 2 ** Math.ceil(Math.log2(wanted)));
    }
    this.levels.set(layer.layerId, level);
    return level;
  }

  forget(layerId: string): void { this.levels.delete(layerId); }

  emit(device: GPUDevice, encoder: GPUCommandEncoder, layer: SceneStrandLayer, buffers: StrandBuffers, page: GPUBuffer, base: number,
    keep: number, defaultMaterial: number, temporaries: GPUBuffer[]): number {
    const render = layer.strands.program.render!, profile = render.profile, scale = worldMatrixScale(layer.worldMatrix);
    const slots = ptFiberSlots(layer, buffers);
    if (!slots) return 0;
    const params = new Float32Array(44);
    packStrandFiberParams(layer, params);
    const radius = 0.5 * render.width * scale;
    params.set([radius, ptFiberSubdivisions(layer), ptFiberInstances(layer), keep], 28);
    const info = new Uint32Array(params.buffer, 32 * 4, 4);
    info.set([buffers.segmentCount, buffers.attributes ? 1 : 0, defaultMaterial, base]);
    // A widened fiber never grows past its ply (or the strand width without a Yarn Profile).
    params[36] = Math.max(radius, profile ? profile.radius * 0.5 * scale : radius);
    const uniform = ptUniformBuffer(device, 'pt-fiber-emission', params, temporaries);
    const module = ptShaderModule(device, 'pt-fiber-emission', `${PT_COMMON_WGSL}\n${STRAND_FIBER_GEOMETRY_SHADER}\n${emissionSource}`);
    const pipeline = emissionPipeline(device, module);
    const attributes = buffers.attributes ?? fallbackAttributes(device);
    const pass = encoder.beginComputePass({ label: 'pt-fiber-emission' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: buffers.positions } },
      { binding: 2, resource: { buffer: buffers.segments } }, { binding: 3, resource: { buffer: attributes } },
      { binding: 4, resource: { buffer: page } },
    ] }));
    const shape = ptDispatchShape(device, slots);
    pass.dispatchWorkgroups(shape.x, shape.y);
    pass.end();
    return slots;
  }
}

const pipelinesByModule = new WeakMap<GPUShaderModule, GPUComputePipeline>();
function emissionPipeline(device: GPUDevice, module: GPUShaderModule): GPUComputePipeline {
  let pipeline = pipelinesByModule.get(module);
  if (!pipeline) { pipeline = ptComputePipeline(device, 'pt-fiber-emission', module, 'emitFibers'); pipelinesByModule.set(module, pipeline); }
  return pipeline;
}

const fallbacks = new WeakMap<GPUDevice, GPUBuffer>();
function fallbackAttributes(device: GPUDevice): GPUBuffer {
  let buffer = fallbacks.get(device);
  if (!buffer) {
    buffer = device.createBuffer({ label: 'pt-fiber-no-attributes', size: 16, usage: GPUBufferUsage.STORAGE });
    fallbacks.set(device, buffer);
  }
  return buffer;
}

