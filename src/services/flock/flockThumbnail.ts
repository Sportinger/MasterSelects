import type { Keyframe } from '../../types/keyframes';
import type { FlockDefinition } from '../../types/flock';
import { FlockCpuSolver } from '../../engine/flock/cpu/flockCpuSolver';
import { hexColorToRgb } from '../../utils/colorParam';
import { compileFlockDefinitionCached } from './compiler/flockCompiler';
import { hashFlockString, stableStringify } from './compiler/flockCompilerSupport';
import { indexFlockKeyframes } from './compiler/flockParamEvaluation';
import { FLOCK_PARTICLE_STRIDE, P_AGE, P_POS, type FlockProgram } from './compiler/flockProgramTypes';
import { createFlockClipTimeMap, flockStepForSourceTime } from './time/flockTimeMapper';

/**
 * Explicitly limited flock clip thumbnails: the CPU reference solver runs a
 * capped population at the program's own step rate and a software rasterizer
 * draws an orthographic front projection. This is a labelled preview of the
 * motion, not the GPU scene render (no camera, depth, meshes or lighting).
 */

export const FLOCK_THUMBNAIL_PARTICLE_CAP = 1500;

export interface FlockThumbnailClip {
  id: string;
  flock?: FlockDefinition;
  inPoint: number;
  outPoint: number;
  duration: number;
  reversed?: boolean;
  speed?: number;
}

export interface FlockThumbnailOptions {
  frameCount?: number;
  width?: number;
  height?: number;
  particleCap?: number;
}

export interface FlockThumbnailFrame {
  localTime: number;
  sourceTime: number;
  rgba: Uint8ClampedArray;
}

export interface FlockThumbnailResult {
  key: string;
  width: number;
  height: number;
  frames: FlockThumbnailFrame[];
  requestedParticles: number;
  simulatedParticles: number;
  limited: boolean;
}

export interface FlockThumbnailControl {
  shouldCancel?: () => boolean;
  yieldControl?: () => Promise<void>;
  sliceBudgetMs?: number;
  now?: () => number;
}

type Rgb = [number, number, number];

const BACKGROUND: Rgb = [10, 13, 19];

function resolveOptions(options: FlockThumbnailOptions): Required<FlockThumbnailOptions> {
  return {
    frameCount: Math.max(1, Math.min(16, Math.round(options.frameCount ?? 6))),
    width: Math.max(8, Math.min(512, Math.round(options.width ?? 160))),
    height: Math.max(8, Math.min(512, Math.round(options.height ?? 90))),
    particleCap: Math.max(1, Math.round(options.particleCap ?? FLOCK_THUMBNAIL_PARTICLE_CAP)),
  };
}

/** Flock-namespace keyframes only; order-independent. */
export function flockThumbnailKeyframeSignature(keyframes: readonly Keyframe[] | undefined): string {
  const entries = (keyframes ?? [])
    .filter((keyframe) => keyframe.property.startsWith('flock.node.'))
    .map((keyframe) => [
      keyframe.property,
      keyframe.time,
      keyframe.value,
      keyframe.easing,
      keyframe.handleIn?.x ?? null,
      keyframe.handleIn?.y ?? null,
      keyframe.handleOut?.x ?? null,
      keyframe.handleOut?.y ?? null,
    ] as const)
    .toSorted((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  return stableStringify(entries);
}

/**
 * Invalidation key: compiled semantic hash (layout excluded), visible source
 * window and flock keyframes. Null for clips without a valid graph.
 */
export function getFlockThumbnailKey(
  clip: FlockThumbnailClip,
  keyframes: readonly Keyframe[] | undefined,
  options: FlockThumbnailOptions = {},
): string | null {
  if (!clip.flock) return null;
  const compiled = compileFlockDefinitionCached(clip.flock);
  if (!compiled.ok) return null;
  return hashFlockString(stableStringify({
    semantic: compiled.program.hashes.full,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    duration: clip.duration,
    reversed: clip.reversed === true,
    speed: clip.speed ?? 1,
    keyframes: flockThumbnailKeyframeSignature(keyframes),
    options: resolveOptions(options),
  }));
}

/** Proportional deterministic population cap per emitter; never changes the step rate. */
export function capFlockProgram(program: FlockProgram, cap: number): { program: FlockProgram; limited: boolean } {
  if (program.capacity <= cap) return { program, limited: false };
  const ratio = cap / program.capacity;
  let offset = 0;
  const emitters = program.emitters.map((emitter) => {
    const count = Math.max(1, Math.floor(emitter.count * ratio));
    const capped = { ...emitter, offset, count };
    offset += count;
    return capped;
  });
  const trails = program.trails.map((trail) => ({
    ...trail,
    slotCount: Math.max(0, Math.min(trail.slotCount, Math.ceil(offset * trail.sampleFraction))),
  }));
  return { program: { ...program, capacity: offset, emitters, trails }, limited: true };
}

export function computeFlockThumbnailSampleTimes(
  clip: FlockThumbnailClip,
  frameCount: number,
): Array<{ localTime: number; sourceTime: number }> {
  const map = createFlockClipTimeMap(clip);
  return Array.from({ length: frameCount }, (_, index) => {
    const localTime = (clip.duration * (index + 0.5)) / frameCount;
    return { localTime, sourceTime: Math.max(0, map.toSourceTime(localTime)) };
  });
}

function resolveBranchColor(program: FlockProgram, kinds: readonly string[]): Rgb | null {
  for (const branch of program.branches) {
    if (!kinds.includes(branch.kind)) continue;
    const base = branch.params.colors.color?.base;
    if (!base) continue;
    const rgb = hexColorToRgb(base, '#9fd8ff');
    return [rgb.r, rgb.g, rgb.b];
  }
  return null;
}

function resolveExtent(program: FlockProgram): number {
  let extent = 1;
  for (const emitter of program.emitters) {
    const center = emitter.params.vectors.center?.base ?? [0, 0, 0];
    const size = emitter.params.vectors.size?.base ?? [80, 80, 80];
    extent = Math.max(extent, Math.abs(center[0]) + Math.abs(size[0]), Math.abs(center[1]) + Math.abs(size[1]));
  }
  const boundary = program.boundary;
  const boundarySize = boundary?.params.vectors.size?.base;
  if (boundary && boundarySize) {
    const center = boundary.params.vectors.center?.base ?? [0, 0, 0];
    const half = boundary.params.enums.shape === 'box'
      ? Math.max(boundarySize[0], boundarySize[1]) * 0.5
      : boundarySize[0];
    extent = Math.max(extent, half + Math.max(Math.abs(center[0]), Math.abs(center[1])));
  }
  return extent;
}

interface TrailRaster {
  ring: Float32Array;
  samples: number;
  head: number;
}

export interface FlockThumbnailRasterInput {
  state: Float32Array;
  capacity: number;
  width: number;
  height: number;
  extent: number;
  pointColor: Rgb;
  curveColor?: Rgb | null;
  trails?: readonly TrailRaster[];
}

/** Software rasterizer (additive, integer accumulation) — deterministic and canvas-free. */
export function rasterizeFlockThumbnail(input: FlockThumbnailRasterInput): Uint8ClampedArray {
  const { width, height } = input;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = BACKGROUND[0];
    rgba[pixel * 4 + 1] = BACKGROUND[1];
    rgba[pixel * 4 + 2] = BACKGROUND[2];
    rgba[pixel * 4 + 3] = 255;
  }
  const scale = (Math.min(width, height) * 0.46) / Math.max(1e-6, input.extent);
  const cx = width / 2;
  const cy = height / 2;
  const add = (x: number, y: number, color: Rgb, alpha: number) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const index = (py * width + px) * 4;
    rgba[index] = Math.min(255, rgba[index] + Math.round(color[0] * alpha));
    rgba[index + 1] = Math.min(255, rgba[index + 1] + Math.round(color[1] * alpha));
    rgba[index + 2] = Math.min(255, rgba[index + 2] + Math.round(color[2] * alpha));
  };

  const curveColor = input.curveColor ?? input.pointColor;
  for (const trail of input.trails ?? []) {
    const slotCount = trail.ring.length / (trail.samples * 4);
    for (let slot = 0; slot < slotCount; slot += 1) {
      const base = slot * trail.samples;
      for (let sample = 0; sample < trail.samples - 1; sample += 1) {
        if (sample === trail.head) continue; // newest -> oldest wrap
        const a = (base + sample) * 4;
        const b = (base + sample + 1) * 4;
        const tag = trail.ring[a + 3];
        if (tag <= 0 || trail.ring[b + 3] !== tag) continue;
        const x0 = cx + trail.ring[a] * scale;
        const y0 = cy - trail.ring[a + 1] * scale;
        const x1 = cx + trail.ring[b] * scale;
        const y1 = cy - trail.ring[b + 1] * scale;
        const steps = Math.min(64, Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, curveColor, 0.16);
        }
      }
    }
  }

  for (let index = 0; index < input.capacity; index += 1) {
    const base = index * FLOCK_PARTICLE_STRIDE;
    if (input.state[base + P_AGE] < 0) continue;
    add(cx + input.state[base + P_POS] * scale, cy - input.state[base + P_POS + 1] * scale, input.pointColor, 0.55);
  }
  return rgba;
}

/**
 * Simulates the capped program once through all sample times (sorted by source
 * time) and rasterizes each frame. Yields to the caller between slices and
 * aborts when `shouldCancel` reports a superseded or busy state.
 */
export async function renderFlockThumbnailFrames(
  clip: FlockThumbnailClip,
  keyframes: readonly Keyframe[] | undefined,
  options: FlockThumbnailOptions = {},
  control: FlockThumbnailControl = {},
): Promise<FlockThumbnailResult | null> {
  const key = getFlockThumbnailKey(clip, keyframes, options);
  if (!key || !clip.flock) return null;
  const compiled = compileFlockDefinitionCached(clip.flock);
  if (!compiled.ok) return null;
  const resolved = resolveOptions(options);
  const { program, limited } = capFlockProgram(compiled.program, resolved.particleCap);
  const solver = new FlockCpuSolver(program);
  const context = { keyframesByProperty: indexFlockKeyframes(keyframes) };
  const samples = computeFlockThumbnailSampleTimes(clip, resolved.frameCount);
  const order = samples.map((_, index) => index).toSorted((a, b) => samples[a].sourceTime - samples[b].sourceTime);
  const pointColor = resolveBranchColor(compiled.program, ['points', 'instances', 'glyphs', 'vectors', 'links']) ?? [159, 216, 255];
  const curveColor = resolveBranchColor(compiled.program, ['curves']);
  const extent = resolveExtent(compiled.program);
  const now = control.now ?? (() => performance.now());
  const sliceBudgetMs = control.sliceBudgetMs ?? 8;
  let sliceStart = now();
  const frames = new Array<FlockThumbnailFrame>(samples.length);

  for (const index of order) {
    const target = flockStepForSourceTime(program, samples[index].sourceTime).step;
    if (target < solver.step) solver.reset();
    while (solver.step < target) {
      solver.advanceTo(Math.min(target, solver.step + 4), context);
      if (control.shouldCancel?.()) return null;
      if (control.yieldControl && now() - sliceStart > sliceBudgetMs) {
        await control.yieldControl();
        sliceStart = now();
        if (control.shouldCancel?.()) return null;
      }
    }
    frames[index] = {
      localTime: samples[index].localTime,
      sourceTime: samples[index].sourceTime,
      rgba: rasterizeFlockThumbnail({
        state: solver.state,
        capacity: program.capacity,
        width: resolved.width,
        height: resolved.height,
        extent,
        pointColor,
        curveColor,
        trails: program.trails.map((trail, trailIndex) => ({
          ring: solver.trailRings[trailIndex],
          samples: trail.samples,
          head: Math.floor(solver.step / trail.interval) % trail.samples,
        })),
      }),
    };
  }

  return {
    key,
    width: resolved.width,
    height: resolved.height,
    frames,
    requestedParticles: compiled.program.capacity,
    simulatedParticles: program.capacity,
    limited,
  };
}
