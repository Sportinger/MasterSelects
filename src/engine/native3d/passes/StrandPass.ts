import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import type { SceneCamera, SceneLayer3DData, SceneLightLayer, SceneStrandLayer } from '../../scene/types';
import { StrandBufferCache, type StrandBuffers } from './strandBuffers';
import { packStrandLights, STRAND_LIGHT_FLOATS } from './strandLights';
import { STRAND_SHADOW_MAP_SIZE, strandShadowView, type StrandShadowView } from './strandShadowLight';
import { StrandShadowMaps, type StrandShadowTargets } from './strandShadowMaps';
import { StrandCoverageTargets } from './StrandCoverageTargets';
import { StrandComputeRaster } from './strandRaster/StrandComputeRaster';
import { STRAND_SCENE_SHADER } from './strandShaders';
import { multiplyMat4 } from '../../scene/SceneTransformUtils';
import { Logger } from '../../../services/logger';

const log = Logger.create('StrandPass');
export { STRAND_SCENE_SHADER };
/** `twist.w` of the strand uniforms: how a layer is antialiased. */
const ANTIALIASING_MODE = { hashed: 0, coverage4x: 1, analytic: 2 } as const;
/** Fixed layout up to the flyaway vector, then the packed scene lights, the shadowing light and its mesh occluders. */
const LIGHTS_OFFSET = 76;
const SHADOW_OFFSET = LIGHTS_OFFSET + STRAND_LIGHT_FLOATS;
const OCCLUDER_OFFSET = SHADOW_OFFSET + 24;
const UNIFORM_FLOATS = OCCLUDER_OFFSET + 20;
/** Deep opacity one fully covering fiber adds; about one yarn in front leaves a third of the light. */
const OPACITY_PER_FIBER = 0.3;
/** Extra fiber instances per yarn that can leave it as flyaways; Density sets how often each one does. */
export const FLYAWAY_CHANNELS = 4;
/**
 * Key light in scene space when no light clip is present: upper left, toward the camera. The shared
 * scene is +Y up and +Z toward the camera, like the Y-up geometry graphs (gravity pulls to -Y).
 */
const KEY_LIGHT = normalize3([-0.4, 0.7, 0.6]);
const AMBIENT = 0.35;

/** Spline pieces per segment in close-ups; one piece covers about this many pixels. */
const MAX_SUBDIVISIONS = 8;
const PIXELS_PER_PIECE = 5;

/**
 * Spline pieces per segment for a layer: segments that span many pixels are split so curves stay
 * round. The nearest point of the layer bounds decides, so a close-up anywhere on the sheet counts.
 */
export function strandSubdivisions(segmentLength: number, extent: number, world: Float32Array, cameraPosition: readonly number[],
  camera: Pick<SceneCamera, 'projectionMatrix' | 'viewport'>): number {
  const scale = worldMatrixScale(world);
  const distance = Math.hypot(world[12] - cameraPosition[0], world[13] - cameraPosition[1], world[14] - cameraPosition[2]);
  const nearest = Math.max(distance - extent * scale, distance * 0.05, 1e-3);
  const pixels = segmentLength * scale * Math.abs(camera.projectionMatrix[5]) * camera.viewport.height * 0.5 / nearest;
  return Math.max(1, Math.min(MAX_SUBDIVISIONS, Math.ceil(pixels / PIXELS_PER_PIECE)));
}
export interface PreparedStrandLayer { layer: SceneStrandLayer; buffers: StrandBuffers }

/**
 * NDC depth range of a layer bounded by a sphere of `radius` (scene units) around its origin, for
 * this camera; the analytic raster spreads its depth key over it.
 */
export function strandDepthRange(world: Float32Array, radius: number, camera: Pick<SceneCamera, 'viewMatrix' | 'projectionMatrix'>): [number, number] {
  const v = camera.viewMatrix, p = camera.projectionMatrix;
  // View-space depth of the layer origin; the camera looks down -Z.
  const z = v[2] * world[12] + v[6] * world[13] + v[10] * world[14] + v[14];
  const ndc = (viewZ: number) => {
    const clipW = p[11] * viewZ + p[15];
    return clipW > 1e-6 ? (p[10] * viewZ + p[14]) / clipW : 0;
  };
  const near = Math.max(0, Math.min(1, ndc(z + radius))), far = Math.max(0, Math.min(1, ndc(z - radius)));
  return near < far ? [near, far] : [0, 1];
}

function normalize3(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function parseStrandColor(color: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const value = match ? Number.parseInt(match[1], 16) : 0xffffff;
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

/** Camera position from a rigid column-major view matrix: -Rᵀ·t. */
export function cameraPositionFromView(view: Float32Array): [number, number, number] {
  const t = [view[12], view[13], view[14]];
  return [0, 1, 2].map(axis => -(view[axis * 4] * t[0] + view[axis * 4 + 1] * t[1] + view[axis * 4 + 2] * t[2])) as [number, number, number];
}

/** Average axis scale of a column-major world matrix; strand width follows the layer scale. */
export function worldMatrixScale(world: Float32Array): number {
  return (Math.hypot(world[0], world[1], world[2]) + Math.hypot(world[4], world[5], world[6]) + Math.hypot(world[8], world[9], world[10])) / 3;
}

export { SEGMENT_HAS_NEXT, SEGMENT_HAS_PREVIOUS, strandSegmentStarts } from './strandBuffers';

interface StrandDraw {
  layer: SceneStrandLayer;
  buffers: StrandBuffers;
  /** Uniforms except the viewer, which the shadow and main passes fill in. */
  base: Float32Array;
  instances: number;
  shadow: StrandShadowView | null;
  /** Distance between deep opacity layers (scene units), about one yarn. */
  spacing: number;
  /** Bounding sphere radius around the layer origin, yarn included (scene units). */
  radius: number;
}

/** Draws opaque meshes into `depth` as seen through `view` and `projection` (a shadowing light). */
export type StrandShadowCasters = (encoder: GPUCommandEncoder, depth: GPUTextureView, view: Float32Array, projection: Float32Array) => void;

/** What lit meshes need to receive a strand layer's shadow: the casting light and this frame's maps. */
export interface StrandShadowReceiver {
  lightLayerId: string;
  depth: GPUTextureView;
  opacity: GPUTextureView;
  sampler: GPUSampler;
  /** Light view-projection (16), then (unused, layer spacing, unused, strength), then (near, far, 1 perspective, 0). */
  uniforms: Float32Array;
}

/** A frame's strand draws with their shadow maps, rendered before the opaque scene passes. */
export interface StrandShadowFrame {
  draws: StrandDraw[];
  targets: StrandShadowTargets[];
  /** The first strand layer shadowed by a scene light; meshes lit by that light receive its shadow. */
  receiver: StrandShadowReceiver | null;
}

/** Writes the camera a pass renders from: view, projection, eye, viewport and spline pieces. */
function writeViewer(data: Float32Array, view: Float32Array, projection: Float32Array, eye: readonly number[],
  width: number, height: number, subdivisions: number): Float32Array {
  data.set(view, 16);
  data.set(projection, 32);
  data.set([eye[0], eye[1], eye[2]], 48);
  data[57] = width; data[58] = height; data[70] = subdivisions;
  return data;
}

export class StrandPass {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private coveragePipeline: GPURenderPipeline | null = null;
  private depthPipeline: GPURenderPipeline | null = null;
  private opacityPipeline: GPURenderPipeline | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private readonly buffers = new StrandBufferCache();
  private readonly shadows = new StrandShadowMaps();
  private readonly coverage = new StrandCoverageTargets();
  private readonly raster = new StrandComputeRaster();

  collect(layers: SceneLayer3DData[]): SceneStrandLayer[] {
    return layers.filter((layer): layer is SceneStrandLayer => layer.kind === 'strands');
  }

  private initialize(device: GPUDevice): void {
    if (this.device === device && this.pipeline) return;
    this.dispose();
    this.device = device;
    // The analytic raster's compute kernels bind the same group as the render passes.
    const all = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    this.layout = device.createBindGroupLayout({ label: 'native-strands', entries: [
      { binding: 0, visibility: all, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 7, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ] });
    const module = device.createShaderModule({ code: STRAND_SCENE_SHADER, label: 'native-strands' });
    void module.getCompilationInfo?.().then(info => {
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) log.error('Strand shader compilation failed', errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`));
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const vertex = { module, entryPoint: 'strandVertex' };
    const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
    this.pipeline = device.createRenderPipeline({ label: 'native-strands', layout, vertex, primitive,
      fragment: { module, entryPoint: 'strandFragment', targets: [{ format: SCENE_COLOR_FORMAT }] },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' } });
    this.coveragePipeline = device.createRenderPipeline({ label: 'native-strands-coverage4x', layout, vertex, primitive,
      fragment: { module, entryPoint: 'strandFragment', targets: [{ format: SCENE_COLOR_FORMAT }] },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
      multisample: { count: 4, alphaToCoverageEnabled: true } });
    this.depthPipeline = device.createRenderPipeline({ label: 'native-strands-shadow-depth', layout, vertex, primitive,
      depthStencil: { format: StrandShadowMaps.depthFormat, depthWriteEnabled: true, depthCompare: 'less' } });
    const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.opacityPipeline = device.createRenderPipeline({ label: 'native-strands-shadow-opacity', layout, vertex, primitive,
      fragment: { module, entryPoint: 'strandOpacityFragment', targets: [{ format: StrandShadowMaps.opacityFormat, blend: { color: add, alpha: add } }] } });
  }

  /** Evaluates changed curve programs and uploads them (cloth is bound on the GPU); replaced buffers retire with this frame. */
  prepare(device: GPUDevice, layers: SceneStrandLayer[], temporaryBuffers: GPUBuffer[]): PreparedStrandLayer[] {
    if (!layers.length) return [];
    this.initialize(device);
    return layers.flatMap(layer => {
      if (!layer.strands.program.render) return [];
      const buffers = this.buffers.prepare(device, layer, temporaryBuffers);
      return buffers ? [{ layer, buffers }] : [];
    });
  }

  /** Everything a layer's passes share: world, look, yarn, flyaways, scene lights and its shadow. */
  private layerUniforms(layer: SceneStrandLayer, buffers: StrandBuffers, lights: readonly SceneLightLayer[]): StrandDraw {
    const render = layer.strands.program.render!, profile = render.profile, scale = worldMatrixScale(layer.worldMatrix);
    const data = new Float32Array(UNIFORM_FLOATS);
    data.set(layer.worldMatrix, 0);
    data.set(parseStrandColor(render.color), 52);
    data[55] = buffers.colors ? 1 : 0;
    data.set([render.width * scale, 0, 0, Math.max(0, Math.min(1, layer.opacity))], 56);
    data.set([...KEY_LIGHT, AMBIENT], 60);
    data.set(profile ? [profile.plies, profile.fibers, profile.radius, profile.plyTwist, profile.fiberTwist] : [1, 1, 0, 0, 0], 64);
    data[71] = ANTIALIASING_MODE[render.antialiasing ?? 'hashed'];
    const flyaways = profile && render.flyaways, channels = flyaways ? FLYAWAY_CHANNELS : 0;
    if (flyaways) {
      data[69] = flyaways.seed;
      data.set([channels / flyaways.density, flyaways.length, flyaways.lift, flyaways.hair], 72);
    }
    packStrandLights(lights, data, LIGHTS_OFFSET);
    // The shadow frames the layer's bounds, padded by the yarn around its curves.
    const center: [number, number, number] = [layer.worldMatrix[12], layer.worldMatrix[13], layer.worldMatrix[14]];
    const pad = (profile ? profile.radius * (1 + (flyaways ? flyaways.lift : 0)) : render.width) * scale;
    const radius = buffers.extent * scale + pad;
    const shadow = strandShadowView(lights, KEY_LIGHT, center, radius);
    const spacing = Math.max(profile ? profile.radius * 2 : render.width * 8, 1e-5) * scale;
    if (shadow) {
      data.set(multiplyMat4(shadow.projection, shadow.view), SHADOW_OFFSET);
      data.set([shadow.lightIndex < 0 ? 1 : shadow.lightIndex + 2, spacing, OPACITY_PER_FIBER, shadow.strength], SHADOW_OFFSET + 16);
      data.set([shadow.near, shadow.far, shadow.perspective ? 1 : 0, 0], SHADOW_OFFSET + 20);
    }
    return { layer, buffers, base: data, instances: (profile ? profile.plies * profile.fibers : 1) + channels, shadow, spacing, radius };
  }

  private bindGroup(device: GPUDevice, uniforms: Float32Array, buffers: StrandBuffers, depth: GPUTextureView, opacity: GPUTextureView,
    temporaryBuffers: GPUBuffer[], label: string, occluders = this.shadows.empty(device).depth): GPUBindGroup {
    const buffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label });
    temporaryBuffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, uniforms.buffer as ArrayBuffer, uniforms.byteOffset, uniforms.byteLength);
    return device.createBindGroup({ layout: this.layout!, label, entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer: buffers.positions } },
      { binding: 2, resource: { buffer: buffers.segments } },
      { binding: 3, resource: depth },
      { binding: 4, resource: opacity },
      { binding: 5, resource: this.shadows.shadowSampler(device) },
      { binding: 6, resource: occluders },
      { binding: 7, resource: { buffer: buffers.colors ?? buffers.positions } },
    ] });
  }

  /** Light depth, then deep opacity layers behind it, both seen from the shadowing light; then its mesh occluders. */
  private renderShadow(device: GPUDevice, commandEncoder: GPUCommandEncoder, draw: StrandDraw, temporaryBuffers: GPUBuffer[],
    casters?: StrandShadowCasters): StrandShadowTargets {
    const shadow = draw.shadow!, targets = this.shadows.targets(device, draw.layer.layerId), empty = this.shadows.empty(device);
    const uniforms = writeViewer(Float32Array.from(draw.base), shadow.view, shadow.projection, shadow.eye,
      STRAND_SHADOW_MAP_SIZE, STRAND_SHADOW_MAP_SIZE, 1);
    const vertices = draw.buffers.segmentCount * 6;
    const depthPass = commandEncoder.beginRenderPass({ label: 'native-strands-shadow-depth', colorAttachments: [],
      depthStencilAttachment: { view: targets.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    depthPass.setPipeline(this.depthPipeline!);
    depthPass.setBindGroup(0, this.bindGroup(device, uniforms, draw.buffers, empty.depth, empty.opacity, temporaryBuffers,
      `native-strands-shadow-depth-${draw.layer.layerId}`));
    depthPass.draw(vertices, draw.instances);
    depthPass.end();
    const opacityPass = commandEncoder.beginRenderPass({ label: 'native-strands-shadow-opacity',
      colorAttachments: [{ view: targets.opacity, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    opacityPass.setPipeline(this.opacityPipeline!);
    opacityPass.setBindGroup(0, this.bindGroup(device, uniforms, draw.buffers, targets.depth, empty.opacity, temporaryBuffers,
      `native-strands-shadow-opacity-${draw.layer.layerId}`));
    opacityPass.draw(vertices, draw.instances);
    opacityPass.end();
    if (!casters || !shadow.casters) return targets;
    const occluders = this.shadows.occluders(device, draw.layer.layerId);
    const clear = commandEncoder.beginRenderPass({ label: 'native-strands-shadow-occluders-clear', colorAttachments: [],
      depthStencilAttachment: { view: occluders, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    clear.end();
    casters(commandEncoder, occluders, shadow.view, shadow.casters.projection);
    draw.base.set(multiplyMat4(shadow.casters.projection, shadow.view), OCCLUDER_OFFSET);
    draw.base.set([1, shadow.casters.near, shadow.casters.far, draw.spacing], OCCLUDER_OFFSET + 16);
    return { ...targets, occluders };
  }

  /**
   * Evaluates the layers' uniforms and renders their shadow maps. Runs before the opaque scene
   * passes, so lit meshes can receive the strands' shadow; `casters` draws opaque meshes from a
   * scene light so they shadow the strands in turn.
   */
  prepareShadows(device: GPUDevice, commandEncoder: GPUCommandEncoder, prepared: PreparedStrandLayer[], temporaryBuffers: GPUBuffer[],
    lights: readonly SceneLightLayer[] = [], casters?: StrandShadowCasters): StrandShadowFrame {
    if (!prepared.length || !this.layout) return { draws: [], targets: [], receiver: null };
    const empty = this.shadows.empty(device);
    const draws = prepared.map(({ layer, buffers }) => this.layerUniforms(layer, buffers, lights));
    const targets = draws.map(draw => draw.shadow ? this.renderShadow(device, commandEncoder, draw, temporaryBuffers, casters) : empty);
    const index = draws.findIndex(draw => draw.shadow?.lightLayerId);
    const caster = draws[index];
    const receiver = caster ? { lightLayerId: caster.shadow!.lightLayerId!, depth: targets[index].depth, opacity: targets[index].opacity,
      sampler: this.shadows.shadowSampler(device), uniforms: Float32Array.from(caster.base.subarray(SHADOW_OFFSET, SHADOW_OFFSET + 24)) } : null;
    return { draws, targets, receiver };
  }

  render(device: GPUDevice, commandEncoder: GPUCommandEncoder, sceneView: GPUTextureView, sceneDepthView: GPUTextureView,
    frame: StrandShadowFrame, camera: SceneCamera, temporaryBuffers: GPUBuffer[]): boolean {
    const { draws, targets } = frame;
    if (!draws.length) return true;
    if (!this.pipeline || !this.layout || !this.depthPipeline || !this.opacityPipeline) return false;
    const cameraPosition = cameraPositionFromView(camera.viewMatrix), { width, height } = camera.viewport;
    const limit = StrandComputeRaster.pieceLimit(device);
    const plans = draws.map((draw, index) => {
      const subdivisions = strandSubdivisions(draw.buffers.segmentLength, draw.buffers.extent, draw.layer.worldMatrix, cameraPosition, camera);
      const uniforms = writeViewer(draw.base, camera.viewMatrix, camera.projectionMatrix, cameraPosition, width, height, subdivisions);
      const bindGroup = this.bindGroup(device, uniforms, draw.buffers, targets[index].depth, targets[index].opacity, temporaryBuffers,
        `native-strands-${draw.layer.layerId}`, targets[index].occluders);
      return { draw, subdivisions, bindGroup, pieces: draw.buffers.segmentCount * subdivisions * draw.instances };
    });
    // Analytic layers too large for the device's buffers are drawn with 4x coverage instead.
    const analytic = plans.filter(plan => plan.draw.base[71] === ANTIALIASING_MODE.analytic && plan.pieces <= limit);
    const ribbons = plans.filter(plan => !analytic.includes(plan));
    if (analytic.length < plans.filter(plan => plan.draw.base[71] === ANTIALIASING_MODE.analytic).length) {
      log.warn('Analytic strand layer exceeds device limits; drawing it with 4x coverage', { limit });
    }
    const multisampled = ribbons.some(plan => plan.draw.base[71] !== ANTIALIASING_MODE.hashed);
    const drawLayers = (pass: GPURenderPassEncoder) => {
      pass.setPipeline(multisampled ? this.coveragePipeline! : this.pipeline!);
      for (const plan of ribbons) {
        pass.setBindGroup(0, plan.bindGroup);
        pass.draw(plan.draw.buffers.segmentCount * 6 * plan.subdivisions, plan.draw.instances);
      }
    };
    if (multisampled) {
      this.coverage.render(device, commandEncoder, sceneView, sceneDepthView, width, height, drawLayers);
    } else if (ribbons.length) {
      const pass = commandEncoder.beginRenderPass({ label: 'native-scene-strands-pass',
        colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
      drawLayers(pass);
      pass.end();
    }
    for (const plan of analytic) {
      this.raster.render(device, commandEncoder, this.layout, sceneView, sceneDepthView, width, height, { bindGroup: plan.bindGroup,
        pieces: plan.pieces, subdivisions: plan.subdivisions, instances: plan.draw.instances,
        depthRange: strandDepthRange(plan.draw.layer.worldMatrix, plan.draw.radius, camera) }, temporaryBuffers);
    }
    return true;
  }

  dispose(): void {
    this.buffers.dispose();
    this.shadows.dispose();
    this.coverage.dispose();
    this.raster.dispose();
    this.pipeline = null;
    this.coveragePipeline = null;
    this.depthPipeline = null;
    this.opacityPipeline = null;
    this.layout = null;
    this.device = null;
  }
}
