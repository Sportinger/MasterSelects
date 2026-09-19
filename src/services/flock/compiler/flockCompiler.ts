import type {
  FlockDefinition,
  FlockDiagnostic,
  FlockEdge,
  FlockNode,
  FlockProperty,
} from '../../../types/flock';
import { expandFlockGroups } from '../graph/flockGroupExpansion';
import { isParticipatingFlockNode, validateFlockDefinition } from '../graph/flockGraphValidation';
import type { FlockInvalidation } from '../operators/flockOperatorTypes';
import {
  FLOCK_OUTPUT_OPERATOR_ID,
  FLOCK_SIMULATION_OPERATOR_ID,
  getFlockOperator,
} from '../operators/flockOperatorRegistry';
import {
  buildParamBundle,
  hashFlockString,
  nextPowerOfTwo,
  selectTrailSlots,
  stableStringify,
} from './flockCompilerSupport';
import {
  FLOCK_MAX_BRANCHES,
  FLOCK_MAX_OBSTACLES,
  FLOCK_MAX_OPS,
  FLOCK_MAX_PALETTES,
  FLOCK_MAX_PATHS,
  FLOCK_MAX_SELECTIONS,
  FLOCK_MAX_VALUES,
  FLOCK_PARTICLE_BYTES,
  FLOCK_SOLVER_VERSION,
  type FlockBranchKind,
  type FlockBranchSpec,
  type FlockCompileResult,
  type FlockEmitterSpec,
  type FlockNodeSpec,
  type FlockOpKind,
  type FlockOpSpec,
  type FlockProgram,
  type FlockSelectionKind,
  type FlockSelectionSpec,
  type FlockTrailSpec,
  type FlockValueKind,
  type FlockValueSpec,
} from './flockProgramTypes';

const OP_KINDS: Record<string, FlockOpKind> = {
  'flock.rules': 'rules',
  'flock.attractor': 'attractor',
  'flock.vortex': 'vortex',
  'flock.turbulence': 'turbulence',
  'flock.drag': 'drag',
  'flock.wind': 'wind',
  'flock.cruise': 'cruise',
  'flock.cluster': 'cluster',
  'flock.follow-path': 'follow-path',
};

const SELECTION_KINDS: Record<string, FlockSelectionKind> = {
  'flock.select-group': 'group',
  'flock.select-fraction': 'fraction',
  'flock.select-region': 'region',
  'flock.select-speed': 'speed',
  'flock.select-age': 'age',
  'flock.select-combine': 'combine',
};

const VALUE_KINDS: Record<string, FlockValueKind> = {
  'flock.value': 'value',
  'flock.math': 'math',
  'flock.remap': 'remap',
  'flock.oscillator': 'oscillator',
  'flock.time': 'time',
  'flock.audio': 'audio',
};

const BRANCH_KINDS: Record<string, FlockBranchKind> = {
  'flock.render-points': 'points',
  'flock.render-instances': 'instances',
  'flock.render-links': 'links',
  'flock.render-curves': 'curves',
  'flock.render-glyphs': 'glyphs',
  'flock.render-vectors': 'vectors',
};

class CompileError extends Error {
  readonly diagnostic: FlockDiagnostic;

  constructor(diagnostic: FlockDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

const compileCache = new WeakMap<FlockDefinition, FlockCompileResult>();

/** Compiles by definition identity; store edits always produce new definition objects. */
export function compileFlockDefinitionCached(definition: FlockDefinition): FlockCompileResult {
  const cached = compileCache.get(definition);
  if (cached) return cached;
  const result = compileFlockDefinition(definition);
  compileCache.set(definition, result);
  return result;
}

export function compileFlockDefinition(definition: FlockDefinition): FlockCompileResult {
  const validation = validateFlockDefinition(definition);
  if (!validation.valid) {
    return { ok: false, program: null, diagnostics: validation.diagnostics };
  }
  try {
    const program = lowerFlockGraph(definition, validation.diagnostics);
    return { ok: true, program, diagnostics: program.diagnostics };
  } catch (error) {
    if (error instanceof CompileError) {
      return { ok: false, program: null, diagnostics: [...validation.diagnostics, error.diagnostic] };
    }
    throw error;
  }
}

function lowerFlockGraph(definition: FlockDefinition, inheritedDiagnostics: FlockDiagnostic[]): FlockProgram {
  const expanded = expandFlockGroups(definition);
  const diagnostics: FlockDiagnostic[] = [...inheritedDiagnostics];
  const nodeById = new Map(expanded.nodes.map((node) => [node.id, node]));
  const sourceId = (nodeId: string) => expanded.sourceNodeIds.get(nodeId) ?? nodeId;
  const fail = (code: string, message: string, nodeIds: string[] = []): never => {
    throw new CompileError({ code, severity: 'error', message, nodeIds: nodeIds.map(sourceId) });
  };

  const incoming = (nodeId: string, port: string): FlockEdge[] =>
    expanded.edges.filter((edge) => edge.to.nodeId === nodeId && edge.to.port === port);

  /** Follows passthrough bypasses; returns null for muted upstream nodes. */
  const resolveUpstream = (edge: FlockEdge): { node: FlockNode; port: string } | null => {
    let node = nodeById.get(edge.from.nodeId);
    let port = edge.from.port;
    for (let guard = 0; node && guard < 64; guard += 1) {
      const operator = getFlockOperator(node.operator);
      if (!node.bypassed || !operator || operator.bypass.kind === 'none') return { node, port };
      if (operator.bypass.kind === 'mute' || operator.bypass.output !== port) return null;
      const upstream = incoming(node.id, operator.bypass.input)[0];
      if (!upstream) return null;
      node = nodeById.get(upstream.from.nodeId);
      port = upstream.from.port;
    }
    return null;
  };

  const used = new Set<string>();
  const topology: Record<string, unknown> = { solver: FLOCK_SOLVER_VERSION, loop: definition.time };
  const staticByClass: Record<FlockInvalidation, Record<string, unknown>> = {
    appearance: {}, derived: {}, behavior: {}, topology: {},
  };
  const propertiesByClass: Record<FlockInvalidation, Set<FlockProperty>> = {
    appearance: new Set(), derived: new Set(), behavior: new Set(), topology: new Set(),
  };

  // ----- values (scalar DAG) -----
  const values: FlockValueSpec[] = [];
  const valueIndexByNode = new Map<string, number>();
  const drivenParamsFor = (node: FlockNode): Map<string, number> => {
    const driven = new Map<string, number>();
    const operator = getFlockOperator(node.operator);
    for (const input of operator?.inputs ?? []) {
      if (!input.drivesParam) continue;
      const edge = incoming(node.id, input.id)[0];
      const upstream = edge ? resolveUpstream(edge) : null;
      if (upstream) driven.set(input.drivesParam, lowerValue(upstream.node));
    }
    return driven;
  };
  const specFor = (node: FlockNode, driven?: Map<string, number>): FlockNodeSpec => {
    used.add(node.id);
    const built = buildParamBundle(node, { paramOwners: expanded.paramOwners, drivenParams: driven });
    for (const invalidation of Object.keys(built.staticByClass) as FlockInvalidation[]) {
      staticByClass[invalidation][node.id] = built.staticByClass[invalidation];
      for (const property of built.propertiesByClass[invalidation]) propertiesByClass[invalidation].add(property);
    }
    return { nodeId: node.id, sourceNodeId: sourceId(node.id), operator: node.operator, params: built.bundle };
  };
  function lowerValue(node: FlockNode): number {
    const existing = valueIndexByNode.get(node.id);
    if (existing !== undefined) return existing;
    const kind = VALUE_KINDS[node.operator];
    if (!kind) fail('value-type', `${node.operator} cannot drive a scalar input.`, [node.id]);
    const driven = drivenParamsFor(node);
    if (values.length >= FLOCK_MAX_VALUES) fail('too-many-values', `At most ${FLOCK_MAX_VALUES} value nodes are supported.`, [node.id]);
    const index = values.length;
    values.push({ ...specFor(node, driven), kind });
    valueIndexByNode.set(node.id, index);
    return index;
  }

  // ----- selections -----
  const selections: FlockSelectionSpec[] = [];
  const selectionIndexByNode = new Map<string, number>();
  const lowerSelection = (node: FlockNode): number => {
    const existing = selectionIndexByNode.get(node.id);
    if (existing !== undefined) return existing;
    const kind = SELECTION_KINDS[node.operator];
    if (!kind) fail('selection-type', `${node.operator} is not a selection.`, [node.id]);
    let a = -1;
    let b = -1;
    if (kind === 'combine') {
      const aEdge = incoming(node.id, 'a')[0];
      const bEdge = incoming(node.id, 'b')[0];
      const aNode = aEdge ? resolveUpstream(aEdge) : null;
      const bNode = bEdge ? resolveUpstream(bEdge) : null;
      a = aNode ? lowerSelection(aNode.node) : -1;
      b = bNode ? lowerSelection(bNode.node) : -1;
    }
    if (selections.length >= FLOCK_MAX_SELECTIONS) fail('too-many-selections', `At most ${FLOCK_MAX_SELECTIONS} selections are supported.`, [node.id]);
    const index = selections.length;
    selections.push({ ...specFor(node), kind, a, b });
    selectionIndexByNode.set(node.id, index);
    topology[`sel:${index}`] = [kind, a, b];
    return index;
  };
  const selectionInput = (node: FlockNode, port = 'selection'): number => {
    const edge = incoming(node.id, port)[0];
    const upstream = edge ? resolveUpstream(edge) : null;
    return upstream ? lowerSelection(upstream.node) : -1;
  };

  // ----- output & simulation -----
  const output = expanded.nodes.find((node) => node.operator === FLOCK_OUTPUT_OPERATOR_ID)!;
  used.add(output.id);
  const simulationNodes = expanded.nodes.filter((node) => node.operator === FLOCK_SIMULATION_OPERATOR_ID);
  const simulationNode = simulationNodes.find((node) => isParticipatingFlockNode(node, expanded.edges)) ?? simulationNodes[0];
  const simulationBase = specFor(simulationNode);
  const stepRate = Number(simulationBase.params.enums.stepRate) || 60;
  const simulation = {
    ...simulationBase,
    stepRate,
    neighborLimit: simulationBase.params.integers.neighborLimit ?? 24,
    cellCandidates: simulationBase.params.integers.cellCandidates ?? 32,
    warmupSteps: Math.round((simulationBase.params.numbers.warmup?.base ?? 0) * stepRate),
  };
  topology.simulation = [stepRate, simulation.neighborLimit, simulation.cellCandidates, simulation.warmupSteps];

  // ----- emitters -----
  const emitters: FlockEmitterSpec[] = [];
  const collectSpawn = (edge: FlockEdge) => {
    const upstream = resolveUpstream(edge);
    if (!upstream) return;
    if (upstream.node.operator === 'flock.merge-spawn') {
      used.add(upstream.node.id);
      incoming(upstream.node.id, 'spawn').forEach(collectSpawn);
      return;
    }
    if (upstream.node.operator !== 'flock.emitter') fail('spawn-type', 'Spawn input must come from emitters.', [upstream.node.id]);
    if (emitters.some((emitter) => emitter.nodeId === upstream.node.id)) return;
    const spec = specFor(upstream.node);
    const count = spec.params.integers.count ?? 0;
    const offset = emitters.reduce((sum, emitter) => sum + emitter.count, 0);
    emitters.push({ ...spec, index: emitters.length, offset, count });
    topology[`emitter:${emitters.length - 1}`] = [
      count, spec.params.integers.group, spec.params.integers.seed, spec.params.enums.shape, spec.params.enums.birthMode,
    ];
  };
  incoming(simulationNode.id, 'spawn').forEach(collectSpawn);
  const capacity = emitters.reduce((sum, emitter) => sum + emitter.count, 0);
  if (capacity === 0) fail('no-particles', 'No active emitter feeds the Simulation node.', [simulationNode.id]);

  // ----- behavior ops -----
  const ops: FlockOpSpec[] = [];
  const paths: FlockNodeSpec[] = [];
  const pathIndexByNode = new Map<string, number>();
  const collectBehavior = (edge: FlockEdge) => {
    const upstream = resolveUpstream(edge);
    if (!upstream) return;
    if (upstream.node.operator === 'flock.compose') {
      used.add(upstream.node.id);
      incoming(upstream.node.id, 'behavior').forEach(collectBehavior);
      return;
    }
    const kind = OP_KINDS[upstream.node.operator];
    if (!kind) fail('behavior-type', `${upstream.node.operator} is not a behavior.`, [upstream.node.id]);
    if (ops.some((op) => op.nodeId === upstream.node.id)) return;
    if (ops.length >= FLOCK_MAX_OPS) fail('too-many-ops', `At most ${FLOCK_MAX_OPS} behavior operators are supported.`, [upstream.node.id]);
    let pathIndex = -1;
    if (kind === 'follow-path') {
      const pathEdge = incoming(upstream.node.id, 'path')[0];
      const pathNode = pathEdge ? resolveUpstream(pathEdge)?.node : undefined;
      if (!pathNode) fail('path-missing', 'Follow Path needs a Path.', [upstream.node.id]);
      const known = pathIndexByNode.get(pathNode!.id);
      if (known !== undefined) {
        pathIndex = known;
      } else {
        if (paths.length >= FLOCK_MAX_PATHS) fail('too-many-paths', `At most ${FLOCK_MAX_PATHS} paths are supported.`, [pathNode!.id]);
        pathIndex = paths.length;
        paths.push(specFor(pathNode!));
        pathIndexByNode.set(pathNode!.id, pathIndex);
      }
    }
    const selection = selectionInput(upstream.node);
    const spec = specFor(upstream.node, drivenParamsFor(upstream.node));
    ops.push({ ...spec, kind, selection, pathIndex });
    topology[`op:${ops.length - 1}`] = [kind, selection, pathIndex];
  };
  incoming(simulationNode.id, 'behavior').forEach(collectBehavior);

  // ----- obstacles & boundary -----
  const obstacles: FlockNodeSpec[] = [];
  for (const edge of incoming(simulationNode.id, 'obstacles')) {
    const upstream = resolveUpstream(edge);
    if (!upstream || obstacles.some((obstacle) => obstacle.nodeId === upstream.node.id)) continue;
    if (obstacles.length >= FLOCK_MAX_OBSTACLES) fail('too-many-obstacles', `At most ${FLOCK_MAX_OBSTACLES} obstacles are supported.`, [upstream.node.id]);
    obstacles.push(specFor(upstream.node));
  }
  const boundaryEdge = incoming(simulationNode.id, 'boundary')[0];
  const boundaryUpstream = boundaryEdge ? resolveUpstream(boundaryEdge) : null;
  const boundary = boundaryUpstream ? specFor(boundaryUpstream.node) : null;
  topology.obstacles = obstacles.length;
  topology.boundary = !!boundary;

  // ----- render branches, trails and palettes -----
  const trails: FlockTrailSpec[] = [];
  const trailIndexByNode = new Map<string, number>();
  const palettes: FlockNodeSpec[] = [];
  const paletteIndexByNode = new Map<string, number>();
  const branches: FlockBranchSpec[] = [];

  const requireSimulationParticles = (node: FlockNode, port = 'particles', optional = false): boolean => {
    const edge = incoming(node.id, port)[0];
    const upstream = edge ? resolveUpstream(edge) : null;
    if (!upstream) {
      if (!optional) fail('particles-missing', `${getFlockOperator(node.operator)?.label ?? node.operator} needs particles.`, [node.id]);
      return false;
    }
    if (upstream.node.id !== simulationNode.id) fail('particles-source', 'Particles must come directly from the Simulation node.', [node.id]);
    return true;
  };
  const lowerTrail = (node: FlockNode): number => {
    const known = trailIndexByNode.get(node.id);
    if (known !== undefined) return known;
    requireSimulationParticles(node);
    const spec = specFor(node);
    const fraction = spec.params.numbers.sampleFraction?.base ?? 0.1;
    const maxTrails = spec.params.integers.maxTrails ?? 1000;
    const salt = spec.params.integers.salt ?? 7;
    const slotCount = selectTrailSlots(capacity, fraction, maxTrails, salt).length;
    const index = trails.length;
    trails.push({
      ...spec,
      index,
      samples: spec.params.integers.samples ?? 24,
      interval: spec.params.integers.interval ?? 3,
      slotCount,
      sampleFraction: fraction,
      salt,
    });
    trailIndexByNode.set(node.id, index);
    topology[`trail:${index}`] = [slotCount, trails[index].samples, trails[index].interval, salt, fraction];
    return index;
  };
  const paletteInput = (node: FlockNode): number => {
    const edge = incoming(node.id, 'palette')[0];
    const upstream = edge ? resolveUpstream(edge) : null;
    if (!upstream) return -1;
    const known = paletteIndexByNode.get(upstream.node.id);
    if (known !== undefined) return known;
    if (palettes.length >= FLOCK_MAX_PALETTES) fail('too-many-palettes', `At most ${FLOCK_MAX_PALETTES} palettes are supported.`, [upstream.node.id]);
    palettes.push(specFor(upstream.node));
    paletteIndexByNode.set(upstream.node.id, palettes.length - 1);
    return palettes.length - 1;
  };
  const curvesInput = (node: FlockNode, optional: boolean): number => {
    const edge = incoming(node.id, 'curves')[0];
    const upstream = edge ? resolveUpstream(edge) : null;
    if (!upstream) {
      if (!optional) fail('curves-missing', 'Curves input needs a Trails node.', [node.id]);
      return -1;
    }
    if (upstream.node.operator !== 'flock.trails') fail('curves-source', 'Curves must come from a Trails node.', [upstream.node.id]);
    return lowerTrail(upstream.node);
  };

  for (const edge of incoming(output.id, 'scene')) {
    const upstream = resolveUpstream(edge);
    if (!upstream) continue;
    const node = upstream.node;
    const kind = BRANCH_KINDS[node.operator];
    if (!kind) fail('scene-type', `${node.operator} does not produce scene output.`, [node.id]);
    if (branches.some((branch) => branch.nodeId === node.id)) continue;
    if (branches.length >= FLOCK_MAX_BRANCHES) fail('too-many-branches', `At most ${FLOCK_MAX_BRANCHES} render branches are supported.`, [node.id]);
    let trailIndex = -1;
    if (kind === 'curves') {
      trailIndex = curvesInput(node, false);
    } else if (kind === 'glyphs') {
      const anchor = node.params.anchor ?? 'trail-head';
      if (anchor === 'particles') {
        requireSimulationParticles(node);
      } else {
        trailIndex = curvesInput(node, false);
      }
    } else {
      requireSimulationParticles(node);
    }
    const selection = kind === 'glyphs' ? -1 : selectionInput(node);
    const palette = paletteInput(node);
    branches.push({ ...specFor(node), kind, index: branches.length, selection, palette, trailIndex });
    topology[`branch:${branches.length - 1}`] = [kind, selection, palette, trailIndex];
  }
  if (branches.length === 0) {
    diagnostics.push({ code: 'no-render-branches', severity: 'warning', message: 'Nothing is connected to Scene Output; the swarm simulates but draws nothing.', nodeIds: [sourceId(output.id)] });
  }

  for (const node of expanded.nodes) {
    if (!used.has(node.id)) {
      diagnostics.push({ code: 'unused-node', severity: 'info', message: `${node.label ?? getFlockOperator(node.operator)?.label ?? node.operator} is not connected to the output.`, nodeIds: [sourceId(node.id)] });
    }
  }

  // ----- estimates, assets and hashes -----
  const sortCount = nextPowerOfTwo(Math.max(2, capacity));
  const tableSize = nextPowerOfTwo(Math.max(4096, capacity * 2));
  const stateBytes = capacity * FLOCK_PARTICLE_BYTES * 2;
  const gridBytes = sortCount * 8 + tableSize * 12;
  const trailBytes = trails.reduce((sum, trail) => sum + trail.slotCount * (trail.samples * 16 + 4), 0);
  const linkBytes = branches
    .filter((branch) => branch.kind === 'links')
    .reduce((sum, branch) => sum + Math.min(
      branch.params.integers.maxLinks ?? 20_000,
      Math.ceil(capacity * (branch.params.numbers.sampleFraction?.base ?? 0.3)),
    ) * (branch.params.integers.perParticle ?? 2) * 4, 0);

  const assets = {
    models: branches.map((branch) => branch.params.assets.model).filter((id): id is string => !!id),
    images: [] as string[],
    audioClips: values.map((value) => value.params.assets.clipId).filter((id): id is string => !!id),
  };

  const topologyHash = hashFlockString(stableStringify(topology));
  const behaviorHash = hashFlockString(stableStringify({ topologyHash, behavior: staticByClass.behavior, topologyValues: staticByClass.topology }));
  const derivedHash = hashFlockString(stableStringify({ behaviorHash, derived: staticByClass.derived }));
  const appearanceHash = hashFlockString(stableStringify({ derivedHash, appearance: staticByClass.appearance }));

  return {
    solverVersion: FLOCK_SOLVER_VERSION,
    capacity,
    stepRate,
    dt: 1 / stepRate,
    loopSeconds: definition.time.loop === 'reset' ? Math.max(0.1, definition.time.loopSeconds) : 0,
    simulation,
    emitters,
    ops,
    selections,
    paths,
    obstacles,
    boundary,
    values,
    trails,
    palettes,
    branches,
    behaviorProperties: [...propertiesByClass.behavior, ...propertiesByClass.topology],
    renderProperties: [...propertiesByClass.derived, ...propertiesByClass.appearance],
    assets,
    hashes: {
      topology: topologyHash,
      behavior: behaviorHash,
      derived: derivedHash,
      appearance: appearanceHash,
      full: appearanceHash,
    },
    estimate: {
      stateBytes,
      gridBytes,
      trailBytes,
      linkBytes,
      totalBytes: stateBytes + gridBytes + trailBytes + linkBytes,
    },
    diagnostics,
  };
}
