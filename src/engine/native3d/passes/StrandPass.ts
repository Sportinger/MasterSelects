import shader from '../shaders/StrandScene.wgsl?raw';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import type { SceneCamera, SceneLayer3DData, SceneLightLayer, SceneStrandLayer } from '../../scene/types';
import { evaluateGeometryProgram } from '../../../services/operators/geometry/geometryEvaluation';
import { packStrandPoints } from './strandFrames';
import { packStrandLights, STRAND_LIGHT_FLOATS } from './strandLights';
import { STRAND_SHADOW_MAP_SIZE, strandShadowView, type StrandShadowView } from './strandShadowLight';
import { StrandShadowMaps, type StrandShadowTargets } from './strandShadowMaps';
import { multiplyMat4 } from '../../scene/SceneTransformUtils';
import { Logger } from '../../../services/logger';

const log = Logger.create('StrandPass');
/** Fixed layout up to the flyaway vector, then the packed scene lights, then the shadowing light. */
const LIGHTS_OFFSET = 76;
const SHADOW_OFFSET = LIGHTS_OFFSET + STRAND_LIGHT_FLOATS;
const UNIFORM_FLOATS = SHADOW_OFFSET + 24;
/** Deep opacity one fully covering fiber adds; about one yarn in front leaves a third of the light. */
const OPACITY_PER_FIBER = 0.3;
/** Extra fiber instances per yarn that can leave it as flyaways; Density sets how often each one does. */
export const FLYAWAY_CHANNELS = 4;
/** Evaluated curve buffers kept across frames and render targets, least recently used first. */
const CACHE_LIMIT = 24;
/**
 * The shared scene is displayed with +Y down (like composition pixels) and +Z toward the camera.
 * Geometry graphs are authored Y-up (gravity pulls to -Y, the top edge is +Y), so strands mirror
 * their local Y into the scene.
 */
export function strandSceneMatrix(world: Float32Array): Float32Array {
  const matrix = Float32Array.from(world);
  for (let row = 4; row < 8; row++) matrix[row] = -matrix[row];
  return matrix;
}
/** Key light in scene space when no light clip is present: upper left, toward the camera. */
const KEY_LIGHT = normalize3([-0.4, -0.7, 0.6]);
const AMBIENT = 0.35;

/** `segmentLength`: mean local length of a curve segment; `extent`: largest local distance of a point from the origin. */
interface StrandBuffers { signature: string; positions: GPUBuffer; segments: GPUBuffer; segmentCount: number; segmentLength: number; extent: number }
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

/** Segment flags above the 30-bit point index: the strand continues before / after the segment. */
export const SEGMENT_HAS_PREVIOUS = 0x80000000;
export const SEGMENT_HAS_NEXT = 0x40000000;

/**
 * First point of every drawable segment (consecutive points inside one strand), flagged when the
 * strand continues, so ribbons can share a joint direction with their neighbours.
 */
export function strandSegmentStarts(starts: Uint32Array, counts: Uint32Array): Uint32Array {
  let total = 0;
  for (const count of counts) total += Math.max(0, count - 1);
  const segments = new Uint32Array(total);
  let cursor = 0;
  for (let strand = 0; strand < counts.length; strand++) {
    for (let point = 0; point + 1 < counts[strand]; point++) {
      segments[cursor++] = (starts[strand] + point) | (point > 0 ? SEGMENT_HAS_PREVIOUS : 0) | (point + 2 < counts[strand] ? SEGMENT_HAS_NEXT : 0);
    }
  }
  return segments;
}

interface StrandDraw {
  layer: SceneStrandLayer;
  buffers: StrandBuffers;
  /** Uniforms except the viewer, which the shadow and main passes fill in. */
  base: Float32Array;
  instances: number;
  shadow: StrandShadowView | null;
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
  private depthPipeline: GPURenderPipeline | null = null;
  private opacityPipeline: GPURenderPipeline | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private readonly cache = new Map<string, StrandBuffers>();
  private readonly shadows = new StrandShadowMaps();

  collect(layers: SceneLayer3DData[]): SceneStrandLayer[] {
    return layers.filter((layer): layer is SceneStrandLayer => layer.kind === 'strands');
  }

  private initialize(device: GPUDevice): void {
    if (this.device === device && this.pipeline) return;
    this.dispose();
    this.device = device;
    this.layout = device.createBindGroupLayout({ label: 'native-strands', entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ] });
    const module = device.createShaderModule({ code: shader, label: 'native-strands' });
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
    this.depthPipeline = device.createRenderPipeline({ label: 'native-strands-shadow-depth', layout, vertex, primitive,
      depthStencil: { format: StrandShadowMaps.depthFormat, depthWriteEnabled: true, depthCompare: 'less' } });
    const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.opacityPipeline = device.createRenderPipeline({ label: 'native-strands-shadow-opacity', layout, vertex, primitive,
      fragment: { module, entryPoint: 'strandOpacityFragment', targets: [{ format: StrandShadowMaps.opacityFormat, blend: { color: add, alpha: add } }] } });
  }

  /** Evaluates changed curve programs and uploads them; replaced buffers retire with this frame. */
  prepare(device: GPUDevice, layers: SceneStrandLayer[], temporaryBuffers: GPUBuffer[]): PreparedStrandLayer[] {
    if (!layers.length) return [];
    this.initialize(device);
    return layers.flatMap(layer => {
      const program = layer.strands.program;
      if (!program.render) return [];
      const signature = JSON.stringify(program.stages);
      let buffers = this.cache.get(layer.layerId);
      if (!buffers || buffers.signature !== signature) {
        if (buffers) temporaryBuffers.push(buffers.positions, buffers.segments);
        const curves = evaluateGeometryProgram(program);
        const segments = strandSegmentStarts(curves.starts, curves.counts);
        const points = packStrandPoints(curves);
        const upload = (data: Float32Array | Uint32Array, label: string) => {
          const buffer = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label });
          if (data.byteLength) device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
          return buffer;
        };
        let length = 0, extent = 0;
        const { positions } = curves;
        for (const packed of segments) {
          const index = (packed & 0x3fffffff) * 3;
          length += Math.hypot(positions[index + 3] - positions[index], positions[index + 4] - positions[index + 1], positions[index + 5] - positions[index + 2]);
        }
        for (let index = 0; index < positions.length; index += 3) extent = Math.max(extent, Math.hypot(positions[index], positions[index + 1], positions[index + 2]));
        buffers = { signature, segmentCount: segments.length, segmentLength: segments.length ? length / segments.length : 0, extent,
          positions: upload(points, `native-strands-points-${layer.layerId}`),
          segments: upload(segments, `native-strands-segments-${layer.layerId}`) };
      }
      this.cache.delete(layer.layerId);
      this.cache.set(layer.layerId, buffers);
      while (this.cache.size > CACHE_LIMIT) {
        const [oldest, retired] = this.cache.entries().next().value!;
        this.cache.delete(oldest);
        temporaryBuffers.push(retired.positions, retired.segments);
      }
      return buffers.segmentCount ? [{ layer, buffers }] : [];
    });
  }

  /** Everything a layer's passes share: world, look, yarn, flyaways, scene lights and its shadow. */
  private layerUniforms(layer: SceneStrandLayer, buffers: StrandBuffers, lights: readonly SceneLightLayer[]): StrandDraw {
    const render = layer.strands.program.render!, profile = render.profile, scale = worldMatrixScale(layer.worldMatrix);
    const data = new Float32Array(UNIFORM_FLOATS);
    data.set(strandSceneMatrix(layer.worldMatrix), 0);
    data.set(parseStrandColor(render.color), 52);
    data.set([render.width * scale, 0, 0, Math.max(0, Math.min(1, layer.opacity))], 56);
    data.set([...KEY_LIGHT, AMBIENT], 60);
    data.set(profile ? [profile.plies, profile.fibers, profile.radius, profile.plyTwist, profile.fiberTwist] : [1, 1, 0, 0, 0], 64);
    const flyaways = profile && render.flyaways, channels = flyaways ? FLYAWAY_CHANNELS : 0;
    if (flyaways) {
      data[69] = flyaways.seed;
      data.set([channels / flyaways.density, flyaways.length, flyaways.lift, flyaways.hair], 72);
    }
    packStrandLights(lights, data, LIGHTS_OFFSET);
    // The shadow frames the layer's bounds, padded by the yarn around its curves.
    const center: [number, number, number] = [layer.worldMatrix[12], layer.worldMatrix[13], layer.worldMatrix[14]];
    const pad = (profile ? profile.radius * (1 + (flyaways ? flyaways.lift : 0)) : render.width) * scale;
    const shadow = strandShadowView(lights, KEY_LIGHT, center, buffers.extent * scale + pad);
    if (shadow) {
      const spacing = Math.max(profile ? profile.radius * 2 : render.width * 8, 1e-5) * scale;
      data.set(multiplyMat4(shadow.projection, shadow.view), SHADOW_OFFSET);
      data.set([shadow.lightIndex < 0 ? 1 : shadow.lightIndex + 2, spacing, OPACITY_PER_FIBER, shadow.strength], SHADOW_OFFSET + 16);
      data.set([shadow.near, shadow.far, shadow.perspective ? 1 : 0, 0], SHADOW_OFFSET + 20);
    }
    return { layer, buffers, base: data, instances: (profile ? profile.plies * profile.fibers : 1) + channels, shadow };
  }

  private bindGroup(device: GPUDevice, uniforms: Float32Array, buffers: StrandBuffers, depth: GPUTextureView, opacity: GPUTextureView,
    temporaryBuffers: GPUBuffer[], label: string): GPUBindGroup {
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
    ] });
  }

  /** Light depth, then deep opacity layers behind it, both seen from the shadowing light. */
  private renderShadow(device: GPUDevice, commandEncoder: GPUCommandEncoder, draw: StrandDraw, temporaryBuffers: GPUBuffer[]): StrandShadowTargets {
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
    return targets;
  }

  render(device: GPUDevice, commandEncoder: GPUCommandEncoder, sceneView: GPUTextureView, sceneDepthView: GPUTextureView,
    prepared: PreparedStrandLayer[], camera: SceneCamera, temporaryBuffers: GPUBuffer[], lights: readonly SceneLightLayer[] = []): boolean {
    if (!prepared.length) return true;
    if (!this.pipeline || !this.layout || !this.depthPipeline || !this.opacityPipeline) return false;
    const cameraPosition = cameraPositionFromView(camera.viewMatrix), empty = this.shadows.empty(device);
    const draws = prepared.map(({ layer, buffers }) => this.layerUniforms(layer, buffers, lights));
    // Shadow maps are rendered first: render passes cannot nest.
    const targets = draws.map(draw => draw.shadow ? this.renderShadow(device, commandEncoder, draw, temporaryBuffers) : empty);
    const pass = commandEncoder.beginRenderPass({ label: 'native-scene-strands-pass',
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
    pass.setPipeline(this.pipeline);
    draws.forEach((draw, index) => {
      const subdivisions = strandSubdivisions(draw.buffers.segmentLength, draw.buffers.extent, draw.layer.worldMatrix, cameraPosition, camera);
      const uniforms = writeViewer(draw.base, camera.viewMatrix, camera.projectionMatrix, cameraPosition,
        camera.viewport.width, camera.viewport.height, subdivisions);
      pass.setBindGroup(0, this.bindGroup(device, uniforms, draw.buffers, targets[index].depth, targets[index].opacity, temporaryBuffers,
        `native-strands-${draw.layer.layerId}`));
      pass.draw(draw.buffers.segmentCount * 6 * subdivisions, draw.instances);
    });
    pass.end();
    return true;
  }

  dispose(): void {
    for (const buffers of this.cache.values()) { buffers.positions.destroy(); buffers.segments.destroy(); }
    this.cache.clear();
    this.shadows.dispose();
    this.pipeline = null;
    this.depthPipeline = null;
    this.opacityPipeline = null;
    this.layout = null;
    this.device = null;
  }
}
