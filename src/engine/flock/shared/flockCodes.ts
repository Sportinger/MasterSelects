/** Numeric codes shared by the CPU reference solver, GPU packer and WGSL. */

export const EMITTER_SHAPE_CODES: Record<string, number> = { sphere: 0, shell: 1, box: 2, disc: 3, point: 4, line: 5 };
export const BIRTH_MODE_CODES: Record<string, number> = { burst: 0, stagger: 1 };

export const OP_KIND_CODES: Record<string, number> = {
  rules: 1,
  attractor: 2,
  vortex: 3,
  turbulence: 4,
  drag: 5,
  wind: 6,
  cruise: 7,
  cluster: 8,
  'follow-path': 9,
};

export const SELECTION_KIND_CODES: Record<string, number> = {
  group: 1,
  fraction: 2,
  region: 3,
  speed: 4,
  age: 5,
  combine: 6,
};

export const OBSTACLE_SHAPE_CODES: Record<string, number> = { sphere: 0, box: 1, capsule: 2, plane: 3 };
export const BOUNDARY_SHAPE_CODES: Record<string, number> = { sphere: 0, box: 1 };
export const BOUNDARY_MODE_CODES: Record<string, number> = { contain: 0, wrap: 1, reflect: 2, kill: 3 };
export const GROUP_MODE_CODES: Record<string, number> = { all: 0, same: 1, other: 2 };
export const COMBINE_MODE_CODES: Record<string, number> = { and: 0, or: 1, xor: 2 };
export const PLANAR_AXIS_CODES: Record<string, number> = { x: 0, y: 1, z: 2 };
export const CLUSTER_ASSIGN_CODES: Record<string, number> = { identity: 0, group: 1 };

export function code(table: Record<string, number>, value: string | undefined, fallback = 0): number {
  return value !== undefined && table[value] !== undefined ? table[value] : fallback;
}

/** Salt used for the per-identity random that drives palettes, sizes and cluster assignment. */
export const IDENTITY_SALT = 0x51ed27;
