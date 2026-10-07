import type { FlockBranchSpec, FlockEmitterSpec, FlockResolvedNode, FlockResolvedRender } from '../../../services/flock/compiler/flockProgramTypes';
import { flockGridDims } from '../shared/flockMath';
import { LIGHT_PARAMS_FLOATS, packFlockLight, type FlockLightSetup } from './flockLighting';
import type { SceneCamera } from '../../scene/types';
import { toCpuSelections } from '../cpu/flockCpuStepParams';
import { MAX_GPU_SELECTIONS, SELECTION_SIZE, packSelections } from './flockGpuLayout';
import type { FlockBlendMode, FlockRenderKind } from './FlockGpuPipelines';

export const FRAME_PARAMS_BYTES = 256;
const PALETTE_BLOCK_BYTES = 64 * 8;
const GRID_BLOCK_BYTES = 16 * 8;
export const RENDER_BLOCK_BYTES = FRAME_PARAMS_BYTES + SELECTION_SIZE * MAX_GPU_SELECTIONS + PALETTE_BLOCK_BYTES + GRID_BLOCK_BYTES + LIGHT_PARAMS_FLOATS * 4;
export const BRANCH_BYTES = 256;
export const FLOCK_SIM_TO_WORLD = 0.01;

const COLOR_MODES: Record<string, number> = { constant: 0, palette: 1, speed: 2, age: 3, group: 4, density: 5, distance: 6, along: 7, image: 8 };
const POINT_SHAPES: Record<string, number> = { dot: 0, soft: 1, square: 2, ring: 3, star: 4 };
const GLYPH_SHAPES: Record<string, number> = { dot: 0, ring: 1, square: 2, cube: 3, cross: 4, diamond: 5 };
const BLENDS: Record<string, number> = { additive: 0, alpha: 1, opaque: 2 };
const PALETTE_MODES: Record<string, number> = { group: 0, identity: 1, position: 2, speed: 3, age: 4 };
const FORWARD_AXES: Record<string, number> = { '+z': 0, '-z': 1, '+x': 2, '-x': 3, '+y': 4, '-y': 5 };
const SHADINGS: Record<string, number> = { lit: 0, flat: 1, emissive: 2 };
const ANCHORS: Record<string, number> = { particles: 0, 'trail-head': 1, 'trail-tail': 2 };

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function flockWorldMatrix(layerWorld: Float32Array): Float32Array {
  const scale = new Float32Array([
    FLOCK_SIM_TO_WORLD, 0, 0, 0,
    0, FLOCK_SIM_TO_WORLD, 0, 0,
    0, 0, FLOCK_SIM_TO_WORLD, 0,
    0, 0, 0, 1,
  ]);
  return multiply(layerWorld, scale);
}

export interface FrameBlockInput {
  camera: SceneCamera;
  layerWorld: Float32Array;
  render: FlockResolvedRender;
  emitters: FlockEmitterSpec[];
  light: FlockLightSetup;
  alpha: number;
  capacity: number;
  maxSpeed: number;
  stepRate: number;
  neighborLimit: number;
}

export function packRenderBlock(input: FrameBlockInput): ArrayBuffer {
  const data = new ArrayBuffer(RENDER_BLOCK_BYTES);
  const f = new Float32Array(data);
  const { camera } = input;
  f.set(multiply(camera.projectionMatrix, camera.viewMatrix), 0);
  const world = flockWorldMatrix(input.layerWorld);
  f.set(world, 16);
  f[32] = camera.cameraPosition.x;
  f[33] = camera.cameraPosition.y;
  f[34] = camera.cameraPosition.z;
  f[35] = input.alpha;
  const view = camera.viewMatrix;
  f[36] = view[0];
  f[37] = view[4];
  f[38] = view[8];
  f[39] = input.render.time;
  f[40] = view[1];
  f[41] = view[5];
  f[42] = view[9];
  f[43] = Math.hypot(world[0], world[1], world[2]);
  f[44] = camera.viewport.width;
  f[45] = camera.viewport.height;
  f[46] = input.capacity;
  f[47] = input.maxSpeed;
  f[48] = input.neighborLimit;
  f[49] = Math.min(MAX_GPU_SELECTIONS, input.render.selections.length);
  f[50] = (input.maxSpeed / Math.max(1, input.stepRate) * 4 + 1) ** 2;
  f[51] = Math.abs(camera.projectionMatrix[5]) * camera.viewport.height * 0.5;
  packSelections(f, FRAME_PARAMS_BYTES, { selections: toCpuSelections(input.render.selections) });
  const paletteOffset = (FRAME_PARAMS_BYTES + SELECTION_SIZE * MAX_GPU_SELECTIONS) / 4;
  input.render.palettes.slice(0, 8).forEach(({ p }, index) => {
    const o = paletteOffset + index * 16;
    const colors = [p.c.color1, p.c.color2, p.c.color3, p.c.color4];
    colors.forEach((color, stop) => {
      f[o + stop * 4] = color?.[0] ?? 1;
      f[o + stop * 4 + 1] = color?.[1] ?? 1;
      f[o + stop * 4 + 2] = color?.[2] ?? 1;
    });
    f[o + 3] = PALETTE_MODES[p.e.mode ?? 'position'] ?? 2;
    f[o + 7] = p.n.frequency ?? 0.004;
    f[o + 11] = p.n.range ?? 60;
  });
  const gridOffset = paletteOffset + PALETTE_BLOCK_BYTES / 4;
  input.emitters.slice(0, 8).forEach((emitter) => {
    const o = gridOffset + emitter.index * 4;
    f[o] = emitter.offset;
    f[o + 1] = emitter.count;
    if (emitter.params.enums.shape === 'grid') {
      const [cols, rows] = flockGridDims(emitter.count, emitter.params.vectors.size?.base ?? [80, 80, 80]);
      f[o + 2] = cols;
      f[o + 3] = rows;
    }
  });
  packFlockLight(f, gridOffset + GRID_BLOCK_BYTES / 4, input.light, world);
  return data;
}

/** Render-only sub-particles per simulated point (1 = off). */
export function flockPointChildren(branch: FlockResolvedNode<FlockBranchSpec>): number {
  return Math.max(1, Math.min(FLOCK_MAX_POINT_CHILDREN, Math.round(branch.spec.params.integers.children ?? 1)));
}

export const FLOCK_MAX_POINT_CHILDREN = 16;

/** Sub-particle level of detail: drawn points per render-target pixel before children stop adding detail. */
const POINTS_PER_PIXEL = 1.5;

/**
 * Sub-particles actually drawn at this render size: the node's value is the
 * ceiling, reduced where extra children would only land on sub-pixel overlap
 * (a 1080p preview needs fewer than a 4K export).
 */
export function flockPointChildrenForViewport(branch: FlockResolvedNode<FlockBranchSpec>, capacity: number, viewportPixels: number): number {
  const requested = flockPointChildren(branch);
  if (requested <= 1 || capacity <= 0 || viewportPixels <= 0) return requested;
  const useful = Math.ceil((viewportPixels * POINTS_PER_PIXEL) / capacity);
  return Math.max(1, Math.min(requested, useful));
}

/** Screen-space points up to this diameter (px) draw as one triangle instead of a quad. */
const TRIANGLE_POINT_MAX_PX = 4;

export function flockPointUsesTriangles(branch: FlockResolvedNode<FlockBranchSpec>, viewportHeight = 1080): boolean {
  // A triangle enclosing a disc does not enclose the corners of a square.
  return branch.p.e.shape !== 'square' && (branch.p.e.sizeMode ?? 'screen') === 'screen'
    && !(branch.p.n.shutterSeconds > 0) && !(branch.p.n.softness > 0) && !(branch.p.n.opacityVariance > 0)
    && (branch.p.n.size ?? 4) * (1 + Math.abs(branch.p.n.sizeVariance ?? 0)) * viewportHeight / 1080 <= TRIANGLE_POINT_MAX_PX;
}

/** The bounded 2x2 pixel kernel is only used for opaque screen-space points. */
export function flockPointUsesCompute(branch: FlockResolvedNode<FlockBranchSpec>, viewportHeight: number): boolean {
  return branch.spec.kind === 'points' && branch.p.e.blend === 'opaque'
    && (branch.p.e.sizeMode ?? 'screen') === 'screen'
    && !(branch.p.n.shutterSeconds > 0) && !(branch.p.n.softness > 0) && !(branch.p.n.opacityVariance > 0)
    && (branch.p.n.size ?? 4) * (1 + Math.abs(branch.p.n.sizeVariance ?? 0)) * viewportHeight / 1080 <= 2;
}

export interface PackedBranch {
  data: ArrayBuffer;
  renderKind: FlockRenderKind;
  blend: FlockBlendMode;
}

/** Branch uniform (layout: `Branch` in flockRenderWgsl.ts). */
export function packBranch(
  branch: FlockResolvedNode<FlockBranchSpec>,
  extras: { perParticle?: number; fraction?: number; headRing?: number; slotCount?: number; samples?: number; interval?: number; pointChildren?: number; viewportHeight?: number },
): PackedBranch {
  const { spec, p } = branch;
  const data = new ArrayBuffer(BRANCH_BYTES);
  const f = new Float32Array(data);
  const color = p.c.color ?? [1, 1, 1];
  f.set(color, 0);
  f[3] = p.n.opacity ?? 1;
  const second = spec.kind === 'curves' ? (p.c.tailColor ?? color) : color.map((channel) => channel * 0.25);
  f[4] = second[0];
  f[5] = second[1];
  f[6] = second[2];
  f[7] = p.n.size ?? 3;
  f[8] = ['points', 'instances', 'links', 'curves', 'glyphs', 'vectors', 'room'].indexOf(spec.kind);
  f[9] = COLOR_MODES[p.e.colorMode ?? 'constant'] ?? 0;
  f[10] = spec.kind === 'glyphs' ? GLYPH_SHAPES[p.e.glyph ?? 'square'] ?? 2 : POINT_SHAPES[p.e.shape ?? 'soft'] ?? 1;
  f[11] = (p.e.sizeMode ?? 'screen') === 'world' ? 1 : 0;
  f[12] = p.n.sizeVariance ?? 0;
  f[13] = p.n.distanceFade ?? 0;
  f[14] = p.n.width ?? 1;
  f[15] = p.n.taper ?? 1;
  f[16] = spec.selection;
  f[17] = spec.palette;
  f[18] = p.n.fadeTail ?? 0;
  f[19] = (p.e.smoothing ?? 'catmull') === 'catmull' ? 1 : 0;
  f[20] = p.n.radius ?? 10;
  f[21] = p.n.fadeBand ?? 0.4;
  f[22] = extras.perParticle ?? 1;
  f[23] = extras.fraction ?? p.n.sampleFraction ?? 1;
  f[24] = spec.kind === 'vectors' ? 97 : 131;
  f[25] = extras.samples ?? 1;
  f[26] = extras.interval ?? 1;
  f[27] = spec.params.integers.subdivisions ?? 3;
  f[28] = p.n.swimAmplitude ?? 0;
  f[29] = p.n.swimFrequency ?? 0;
  f[30] = p.n.phaseVariation ?? 0;
  f[31] = SHADINGS[p.e.shading ?? (spec.kind === 'points' ? 'flat' : 'lit')] ?? 0;
  f[32] = (p.e.orientation ?? 'camera') === 'world' ? 1 : 0;
  f[33] = ANCHORS[p.e.anchor ?? 'trail-head'] ?? 1;
  f[34] = p.n.lineWidth ?? 1;
  f[35] = (p.e.mode ?? 'velocity') === 'heading' ? 1 : 0;
  f[36] = p.n.scale ?? 0.25;
  f[37] = extras.headRing ?? 0;
  f[38] = extras.slotCount ?? 0;
  f[39] = FORWARD_AXES[p.e.forwardAxis ?? '+z'] ?? 0;
  const blendName = (spec.kind === 'room' ? 'opaque' : p.e.blend ?? 'additive') as FlockBlendMode;
  f[40] = BLENDS[blendName] ?? 0;
  f[41] = (p.e.widthMode ?? 'screen') === 'world' ? 1 : 0;
  f[42] = spec.kind === 'points' ? extras.pointChildren ?? flockPointChildren(branch) : 1;
  f[43] = p.n.childSpread ?? 1.5;
  if (spec.kind === 'room') {
    const center = p.v.center ?? [0, 0, -60];
    const size = p.v.size ?? [360, 210, 150];
    f.set([center[0], center[1], center[2], Math.max(0, p.n.frame ?? 0)], 44);
    f.set([Math.max(1, size[0]), Math.max(1, size[1]), Math.max(1, size[2]), p.n.cornerShade ?? 0.35], 48);
  } else {
    f[44] = spec.kind === 'points' ? p.n.relief ?? 0 : 0;
    f[45] = spec.kind === 'points' && flockPointUsesTriangles(branch, extras.viewportHeight) ? 1 : 0;
    f[46] = spec.kind === 'points' ? Math.sqrt(flockPointChildren(branch)) : 1;
    f[47] = spec.kind === 'points' && p.e.shape === 'soft' ? Math.max(0, Math.min(1, p.n.softness ?? 0)) : 0;
    f[48] = spec.kind === 'points' ? Math.max(0, Math.min(1, p.n.opacityVariance ?? 0)) : 0;
    f[49] = spec.kind === 'points' ? Math.max(0, Math.min(0.15, p.n.shutterSeconds ?? 0)) : 0;
  }
  let renderKind: FlockRenderKind = spec.kind === 'glyphs' ? 'glyphs' : spec.kind;
  if (spec.kind === 'glyphs' && p.e.glyph === 'cube') renderKind = 'glyphCubes';
  return { data, renderKind, blend: blendName in BLENDS ? blendName : 'additive' };
}
