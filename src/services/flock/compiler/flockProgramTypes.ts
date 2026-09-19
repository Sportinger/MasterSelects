import type { FlockDiagnostic, FlockProperty, FlockVec3 } from '../../../types/flock';

/** Bumped whenever step semantics or the packed state layout change. */
export const FLOCK_SOLVER_VERSION = 2;

/**
 * Packed particle state, 16 float32 values (64 bytes) per particle:
 *  0..2 position, 3 age (negative = dead/unborn)
 *  4..6 velocity, 7 lifetime (0 = immortal)
 *  8..10 smoothed forward, 11 group
 * 12 identity random [0,1), 13 generation, 14 emitter index, 15 neighbor count
 */
export const FLOCK_PARTICLE_STRIDE = 16;
export const FLOCK_PARTICLE_BYTES = FLOCK_PARTICLE_STRIDE * 4;
export const P_POS = 0;
export const P_AGE = 3;
export const P_VEL = 4;
export const P_LIFE = 7;
export const P_FWD = 8;
export const P_GROUP = 11;
export const P_RND = 12;
export const P_GEN = 13;
export const P_EMITTER = 14;
export const P_NEIGHBORS = 15;

export const FLOCK_MAX_OPS = 16;
export const FLOCK_MAX_SELECTIONS = 16;
export const FLOCK_MAX_OBSTACLES = 16;
export const FLOCK_MAX_PATHS = 4;
export const FLOCK_MAX_VALUES = 32;
export const FLOCK_MAX_PALETTES = 8;
export const FLOCK_MAX_BRANCHES = 16;

export interface FlockNumberRef {
  base: number;
  /** Keyframe property (source-time basis) consulted when keyframes exist. */
  property?: FlockProperty;
  /** Value-graph output that replaces the parameter while connected. */
  valueIndex?: number;
}

export interface FlockVecRef {
  base: FlockVec3;
  properties?: [FlockProperty, FlockProperty, FlockProperty];
}

export interface FlockColorRef {
  base: string;
  properties?: [FlockProperty, FlockProperty, FlockProperty];
}

export interface FlockParamBundle {
  numbers: Record<string, FlockNumberRef>;
  vectors: Record<string, FlockVecRef>;
  colors: Record<string, FlockColorRef>;
  enums: Record<string, string>;
  integers: Record<string, number>;
  booleans: Record<string, boolean>;
  assets: Record<string, string>;
}

export interface ResolvedParamBundle {
  n: Record<string, number>;
  v: Record<string, FlockVec3>;
  /** Linear 0..1 RGB. */
  c: Record<string, FlockVec3>;
  e: Record<string, string>;
  i: Record<string, number>;
  b: Record<string, boolean>;
  a: Record<string, string>;
}

export interface FlockNodeSpec {
  /** Expanded (group-flattened) node id. */
  nodeId: string;
  /** Authored node id receiving diagnostics and selection. */
  sourceNodeId: string;
  operator: string;
  params: FlockParamBundle;
}

export interface FlockEmitterSpec extends FlockNodeSpec {
  index: number;
  offset: number;
  count: number;
}

export type FlockOpKind =
  | 'rules'
  | 'attractor'
  | 'vortex'
  | 'turbulence'
  | 'drag'
  | 'wind'
  | 'cruise'
  | 'cluster'
  | 'follow-path';

export interface FlockOpSpec extends FlockNodeSpec {
  kind: FlockOpKind;
  selection: number;
  pathIndex: number;
}

export type FlockSelectionKind = 'group' | 'fraction' | 'region' | 'speed' | 'age' | 'combine';

export interface FlockSelectionSpec extends FlockNodeSpec {
  kind: FlockSelectionKind;
  a: number;
  b: number;
}

export type FlockValueKind = 'value' | 'math' | 'remap' | 'oscillator' | 'time' | 'audio';

export interface FlockValueSpec extends FlockNodeSpec {
  kind: FlockValueKind;
}

export interface FlockTrailSpec extends FlockNodeSpec {
  index: number;
  samples: number;
  interval: number;
  /** Particle slot indices recorded by this trail, deterministic by identity. */
  slotCount: number;
  sampleFraction: number;
  salt: number;
}

export type FlockBranchKind = 'points' | 'instances' | 'links' | 'curves' | 'glyphs' | 'vectors';

export interface FlockBranchSpec extends FlockNodeSpec {
  kind: FlockBranchKind;
  index: number;
  selection: number;
  palette: number;
  trailIndex: number;
}

export interface FlockSimulationSpec extends FlockNodeSpec {
  stepRate: number;
  neighborLimit: number;
  cellCandidates: number;
  warmupSteps: number;
}

export interface FlockMemoryEstimate {
  stateBytes: number;
  gridBytes: number;
  trailBytes: number;
  linkBytes: number;
  totalBytes: number;
}

export interface FlockProgramHashes {
  topology: string;
  behavior: string;
  derived: string;
  appearance: string;
  full: string;
}

export interface FlockProgram {
  solverVersion: number;
  capacity: number;
  stepRate: number;
  dt: number;
  loopSeconds: number;
  simulation: FlockSimulationSpec;
  emitters: FlockEmitterSpec[];
  ops: FlockOpSpec[];
  selections: FlockSelectionSpec[];
  paths: FlockNodeSpec[];
  obstacles: FlockNodeSpec[];
  boundary: FlockNodeSpec | null;
  values: FlockValueSpec[];
  trails: FlockTrailSpec[];
  palettes: FlockNodeSpec[];
  branches: FlockBranchSpec[];
  /** Keyframeable properties whose change requires resimulation. */
  behaviorProperties: FlockProperty[];
  /** Keyframeable properties that only change derived lines or appearance. */
  renderProperties: FlockProperty[];
  assets: { models: string[]; images: string[]; audioClips: string[] };
  hashes: FlockProgramHashes;
  estimate: FlockMemoryEstimate;
  diagnostics: FlockDiagnostic[];
}

export type FlockCompileResult =
  | { ok: true; program: FlockProgram; diagnostics: FlockDiagnostic[] }
  | { ok: false; program: null; diagnostics: FlockDiagnostic[] };

export interface FlockResolvedNode<TSpec extends FlockNodeSpec = FlockNodeSpec> {
  spec: TSpec;
  p: ResolvedParamBundle;
}

/** Everything one fixed step needs, resolved at that step's source time. */
export interface FlockResolvedStep {
  step: number;
  time: number;
  dt: number;
  sim: ResolvedParamBundle;
  emitters: Array<FlockResolvedNode<FlockEmitterSpec>>;
  ops: Array<FlockResolvedNode<FlockOpSpec>>;
  selections: Array<FlockResolvedNode<FlockSelectionSpec>>;
  paths: FlockResolvedNode[];
  obstacles: FlockResolvedNode[];
  boundary: FlockResolvedNode | null;
  /** Spatial index cell size: the largest neighbor radius in use this step. */
  cellSize: number;
}

export interface FlockResolvedRender {
  time: number;
  branches: Array<FlockResolvedNode<FlockBranchSpec>>;
  palettes: FlockResolvedNode[];
  selections: Array<FlockResolvedNode<FlockSelectionSpec>>;
}
