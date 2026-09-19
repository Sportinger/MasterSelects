import type { CpuStepParams } from '../cpu/flockCpuStepParams';

/**
 * Byte layout of the per-step uniform block. Must match `StepBlock` in
 * shaders/flockWgslShared.ts exactly (WGSL uniform alignment: every struct
 * here aligns to 16 bytes).
 */
export const STEP_SIM_SIZE = 128;
export const EMITTER_SIZE = 96;
export const OP_SIZE = 80;
export const SELECTION_SIZE = 64;
export const OBSTACLE_SIZE = 80;
export const PATH_SIZE = 144;
export const MAX_GPU_EMITTERS = 8;
export const MAX_GPU_OPS = 16;
export const MAX_GPU_SELECTIONS = 16;
export const MAX_GPU_OBSTACLES = 16;
export const MAX_GPU_PATHS = 4;

export const EMITTERS_OFFSET = STEP_SIM_SIZE;
export const OPS_OFFSET = EMITTERS_OFFSET + EMITTER_SIZE * MAX_GPU_EMITTERS;
export const SELECTIONS_OFFSET = OPS_OFFSET + OP_SIZE * MAX_GPU_OPS;
export const OBSTACLES_OFFSET = SELECTIONS_OFFSET + SELECTION_SIZE * MAX_GPU_SELECTIONS;
export const PATHS_OFFSET = OBSTACLES_OFFSET + OBSTACLE_SIZE * MAX_GPU_OBSTACLES;
export const STEP_BLOCK_BYTES = PATHS_OFFSET + PATH_SIZE * MAX_GPU_PATHS;
/** Dynamic-offset stride (minUniformBufferOffsetAlignment is at most 256). */
export const STEP_BLOCK_STRIDE = Math.ceil(STEP_BLOCK_BYTES / 256) * 256;

export interface GridBlockInfo {
  count: number;
  sortCount: number;
  tableMask: number;
  stamp: number;
  neighborLimit: number;
  cellCandidates: number;
}

function writeVec(view: Float32Array, offset: number, vector: ArrayLike<number>): void {
  view[offset] = vector[0];
  view[offset + 1] = vector[1];
  view[offset + 2] = vector[2];
}

/** Packs one resolved step into `target` at byte `byteOffset`. */
export function packStepBlock(
  target: ArrayBuffer,
  byteOffset: number,
  params: CpuStepParams,
  grid: GridBlockInfo,
): void {
  const f = new Float32Array(target, byteOffset, STEP_BLOCK_BYTES / 4);
  const u = new Uint32Array(target, byteOffset, STEP_BLOCK_BYTES / 4);
  f.fill(0);
  // SimParams (see WGSL for field order)
  f[0] = params.dt;
  f[1] = params.time;
  f[2] = params.simTime;
  f[3] = params.cellSize;
  f[4] = params.maxSpeed;
  f[5] = params.minSpeed;
  f[6] = params.maxAcceleration;
  f[7] = params.turnRate;
  u[8] = params.planar ? 1 : 0;
  u[9] = params.planarAxis;
  u[10] = grid.count;
  u[11] = grid.tableMask;
  u[12] = grid.neighborLimit;
  u[13] = grid.cellCandidates;
  u[14] = Math.min(MAX_GPU_EMITTERS, params.emitters.length);
  u[15] = Math.min(MAX_GPU_OPS, params.rules.length + params.fields.length);
  u[16] = Math.min(MAX_GPU_SELECTIONS, params.selections.length);
  u[17] = Math.min(MAX_GPU_OBSTACLES, params.obstacles.length);
  u[18] = 0;
  u[19] = grid.sortCount;
  u[20] = params.boundary ? params.boundary.shape : 0;
  u[21] = params.boundary ? params.boundary.mode : 255;
  u[22] = grid.stamp >>> 0;
  u[23] = params.step >>> 0;
  if (params.boundary) {
    writeVec(f, 24, params.boundary.center);
    f[27] = params.boundary.softness;
    writeVec(f, 28, params.boundary.size);
    f[31] = params.boundary.strength;
  }

  params.emitters.slice(0, MAX_GPU_EMITTERS).forEach((emitter, index) => {
    const o = (EMITTERS_OFFSET + index * EMITTER_SIZE) / 4;
    writeVec(f, o, emitter.center);
    f[o + 3] = emitter.offset;
    writeVec(f, o + 4, emitter.size);
    f[o + 7] = emitter.count;
    writeVec(f, o + 8, emitter.direction);
    f[o + 11] = emitter.spread;
    f[o + 12] = emitter.shape;
    f[o + 13] = emitter.birthMode;
    f[o + 14] = emitter.group;
    f[o + 15] = emitter.seed;
    f[o + 16] = emitter.stagger;
    f[o + 17] = emitter.activeFraction;
    f[o + 18] = emitter.lifetime;
    f[o + 19] = emitter.lifetimeVariance;
    f[o + 20] = emitter.respawn ? 1 : 0;
    f[o + 21] = emitter.initialSpeed;
  });

  // Rules first (the CPU solver also evaluates up to two rule sets before fields), then field ops.
  let opIndex = 0;
  for (const rule of params.rules) {
    if (opIndex >= MAX_GPU_OPS) break;
    const o = (OPS_OFFSET + opIndex * OP_SIZE) / 4;
    f[o] = 1;
    f[o + 1] = rule.selection;
    f[o + 2] = -1;
    f[o + 4] = rule.cohesion;
    f[o + 5] = rule.separation;
    f[o + 6] = rule.alignment;
    f[o + 7] = rule.radius;
    f[o + 8] = rule.separationRadius;
    f[o + 9] = rule.cosHalfFov;
    f[o + 10] = rule.groupMode;
    opIndex += 1;
  }
  const pathIndexByParams = new Map<unknown, number>();
  let pathCount = 0;
  for (const field of params.fields) {
    if (opIndex >= MAX_GPU_OPS) break;
    const o = (OPS_OFFSET + opIndex * OP_SIZE) / 4;
    f[o] = field.kind;
    f[o + 1] = field.selection;
    let pathIndex = -1;
    if (field.path) {
      const known = pathIndexByParams.get(field.path);
      if (known !== undefined) {
        pathIndex = known;
      } else if (pathCount < MAX_GPU_PATHS) {
        pathIndex = pathCount;
        pathIndexByParams.set(field.path, pathIndex);
        const p = (PATHS_OFFSET + pathIndex * PATH_SIZE) / 4;
        writeVec(f, p, field.path.center);
        f[p + 3] = field.path.shape;
        f[p + 4] = field.path.radius;
        f[p + 5] = field.path.height;
        f[p + 6] = field.path.turns;
        const m = field.path.rotation;
        writeVec(f, p + 8, [m[0], m[1], m[2]]);
        writeVec(f, p + 12, [m[3], m[4], m[5]]);
        writeVec(f, p + 16, [m[6], m[7], m[8]]);
        field.path.points.forEach((point, pointIndex) => writeVec(f, p + 20 + pointIndex * 4, point));
        pathCount += 1;
      }
    }
    f[o + 2] = pathIndex;
    for (let slot = 0; slot < 8; slot += 1) f[o + 4 + slot] = field.f[slot] ?? 0;
    writeVec(f, o + 12, field.v0);
    writeVec(f, o + 16, field.v1);
    opIndex += 1;
  }
  u[18] = pathCount;

  params.selections.slice(0, MAX_GPU_SELECTIONS).forEach((selection, index) => {
    const o = (SELECTIONS_OFFSET + index * SELECTION_SIZE) / 4;
    f[o] = selection.kind;
    f[o + 1] = selection.invert ? 1 : 0;
    f[o + 2] = selection.a;
    f[o + 3] = selection.b;
    f[o + 4] = selection.f[0];
    f[o + 5] = selection.f[1];
    f[o + 6] = selection.shape;
    writeVec(f, o + 8, selection.v0);
    writeVec(f, o + 12, selection.v1);
  });

  params.obstacles.slice(0, MAX_GPU_OBSTACLES).forEach((obstacle, index) => {
    const o = (OBSTACLES_OFFSET + index * OBSTACLE_SIZE) / 4;
    const m = obstacle.rotation;
    writeVec(f, o, obstacle.center);
    f[o + 3] = obstacle.shape;
    writeVec(f, o + 4, obstacle.size);
    f[o + 7] = obstacle.avoidDistance;
    writeVec(f, o + 8, [m[0], m[1], m[2]]);
    f[o + 11] = obstacle.strength;
    writeVec(f, o + 12, [m[3], m[4], m[5]]);
    writeVec(f, o + 16, [m[6], m[7], m[8]]);
  });
}

/** Selection bytes for the render block (same struct as the step block). */
export function packSelections(target: Float32Array, byteOffset: number, params: Pick<CpuStepParams, 'selections'>): void {
  params.selections.slice(0, MAX_GPU_SELECTIONS).forEach((selection, index) => {
    const o = (byteOffset + index * SELECTION_SIZE) / 4;
    target[o] = selection.kind;
    target[o + 1] = selection.invert ? 1 : 0;
    target[o + 2] = selection.a;
    target[o + 3] = selection.b;
    target[o + 4] = selection.f[0];
    target[o + 5] = selection.f[1];
    target[o + 6] = selection.shape;
    writeVec(target, o + 8, selection.v0);
    writeVec(target, o + 12, selection.v1);
  });
}

export const SORT_PARAMS_STRIDE = 256;
export const TRAIL_PARAMS_STRIDE = 256;

/** Bitonic network passes for a power-of-two element count. */
export function buildBitonicPasses(sortCount: number): Array<{ k: number; j: number }> {
  const passes: Array<{ k: number; j: number }> = [];
  for (let k = 2; k <= sortCount; k *= 2) {
    for (let j = k / 2; j >= 1; j /= 2) passes.push({ k, j });
  }
  return passes;
}
