import shader from '../shaders/StrandScene.wgsl?raw';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import type { SceneCamera, SceneLayer3DData, SceneStrandLayer } from '../../scene/types';
import { evaluateGeometryProgram } from '../../../services/operators/geometry/geometryEvaluation';
import { packStrandPoints } from './strandFrames';
import { Logger } from '../../../services/logger';

const log = Logger.create('StrandPass');
const UNIFORM_FLOATS = 76;
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
/** Fixed key light in scene space until strands consume scene lights: upper left, toward the camera. */
const KEY_LIGHT = normalize3([-0.4, -0.7, 0.6]);
const AMBIENT = 0.35;

interface StrandBuffers { signature: string; positions: GPUBuffer; segments: GPUBuffer; segmentCount: number }
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

export class StrandPass {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private readonly cache = new Map<string, StrandBuffers>();

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
    ] });
    const module = device.createShaderModule({ code: shader, label: 'native-strands' });
    void module.getCompilationInfo?.().then(info => {
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) log.error('Strand shader compilation failed', errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`));
    });
    this.pipeline = device.createRenderPipeline({ label: 'native-strands',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'strandVertex' },
      fragment: { module, entryPoint: 'strandFragment', targets: [{ format: SCENE_COLOR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
    });
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
        buffers = { signature, segmentCount: segments.length,
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

  render(device: GPUDevice, commandEncoder: GPUCommandEncoder, sceneView: GPUTextureView, sceneDepthView: GPUTextureView,
    prepared: PreparedStrandLayer[], camera: SceneCamera, temporaryBuffers: GPUBuffer[]): boolean {
    if (!prepared.length) return true;
    if (!this.pipeline || !this.layout) return false;
    const pass = commandEncoder.beginRenderPass({ label: 'native-scene-strands-pass',
      colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
    pass.setPipeline(this.pipeline);
    const cameraPosition = cameraPositionFromView(camera.viewMatrix);
    for (const { layer, buffers } of prepared) {
      const render = layer.strands.program.render!;
      const data = new Float32Array(UNIFORM_FLOATS);
      data.set(strandSceneMatrix(layer.worldMatrix), 0);
      data.set(camera.viewMatrix, 16);
      data.set(camera.projectionMatrix, 32);
      data.set(cameraPosition, 48);
      data.set(parseStrandColor(render.color), 52);
      data.set([render.width * worldMatrixScale(layer.worldMatrix), camera.viewport.width, camera.viewport.height,
        Math.max(0, Math.min(1, layer.opacity))], 56);
      data.set([...KEY_LIGHT, AMBIENT], 60);
      const profile = render.profile;
      data.set(profile ? [profile.plies, profile.fibers, profile.radius, profile.plyTwist, profile.fiberTwist] : [1, 1, 0, 0, 0], 64);
      const flyaways = profile && render.flyaways, channels = flyaways ? FLYAWAY_CHANNELS : 0;
      if (flyaways) {
        data[69] = flyaways.seed;
        data.set([channels / flyaways.density, flyaways.length, flyaways.lift, flyaways.hair], 72);
      }
      const uniforms = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `native-strands-uniforms-${layer.layerId}` });
      temporaryBuffers.push(uniforms);
      device.queue.writeBuffer(uniforms, 0, data);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.layout, label: `native-strands-${layer.layerId}`, entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.segments } },
      ] }));
      pass.draw(buffers.segmentCount * 6, (profile ? profile.plies * profile.fibers : 1) + channels);
    }
    pass.end();
    return true;
  }

  dispose(): void {
    for (const buffers of this.cache.values()) { buffers.positions.destroy(); buffers.segments.destroy(); }
    this.cache.clear();
    this.pipeline = null;
    this.layout = null;
    this.device = null;
  }
}
