import { describe, expect, it } from 'vitest';
import { createDefaultWeaveGraph, geometryParameterReader, validateWeaveGraph, type SimulationClock } from '../../src/services/operators/geometry/weaveGraph';
import { sampleSimulationTrack, windVelocity } from '../../src/services/operators/geometry/simulationForces';
import type { Keyframe } from '../../src/types/keyframes';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { compileClothSpec, isClothSpec, type ClothSpec } from '../../src/services/operators/geometry/clothProgram';
import { CLOTH_STEP_RATE, ClothSimulation } from '../../src/services/operators/geometry/clothSolver';
import { bindToCloth, clothGridAt, sampleClothGrid } from '../../src/services/operators/geometry/clothSurface';
import { weaveSimulationClock, weaveSimulationTime } from '../../src/services/operators/geometry/strandsLayerSource';
import { addableEffectOperators } from '../../src/services/operators/effectGraphOwner';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const read = geometryParameterReader({});
const defaultSpec = (graph = createDefaultWeaveGraph()) => compileClothSpec(graph, graph.nodes.find(node => node.id === 'cloth')!, read);
const small = (overrides: Partial<ClothSpec> = {}): ClothSpec => ({ ...defaultSpec(), columns: 12, rows: 8, substeps: 4, turn: 0, ...overrides });
const compile = (graph: EffectOperatorGraph, simulationTime: number) => compileGeometryGraph(graph, read, undefined, { simulationTime });

describe('Weave cloth', () => {
  it('reads the shared force nodes into the cloth spec', () => {
    const graph = createDefaultWeaveGraph();
    expect(validateWeaveGraph(graph)).toEqual([]);
    expect(defaultSpec(graph)).toMatchObject({ columns: 40, rows: 24, substeps: 6, pin: 4, gravity: 0, drag: 0,
      winds: [{ direction: [0.2, 0, 1], strength: 0.35, gust: 0.5 }], turbulence: [{ strength: 0.15, frequency: 1.5 }] });
    const offered = new Set(addableEffectOperators('weave').map(operator => operator.id));
    for (const id of ['geometry.cloth-sheet', 'geometry.surface-bind', 'forces.wind', 'forces.gravity', 'forces.turbulence', 'forces.drag']) expect(offered.has(id), id).toBe(true);
  });

  it('rejects force inputs it would not evaluate', () => {
    const graph = createDefaultWeaveGraph();
    graph.nodes.push({ id: 'gust', operator: 'values.number', bindings: {}, operatorVersion: 1, constants: { value: 3 } });
    graph.edges.push({ id: 'gust-wind', from: 'gust', output: 'value', to: 'wind', input: 'strength' });
    expect(() => defaultSpec(graph)).toThrow(/disconnect its inputs/);
  });

  it('is deterministic across playback, jumps and checkpoints', () => {
    const spec = small();
    const direct = Float64Array.from(new ClothSimulation(spec).positionsAt(95));
    const scrubbed = new ClothSimulation(spec);
    scrubbed.positionsAt(70); scrubbed.positionsAt(40); scrubbed.positionsAt(12);
    expect(Array.from(scrubbed.positionsAt(95))).toEqual(Array.from(direct));
  });

  it('holds the pinned edge and billows downwind', () => {
    const spec = small({ pin: 1, turbulence: [], winds: [{ direction: [0, 0, 1], strength: 1, gust: 0 }] });
    const rest = new ClothSimulation(spec).positionsAt(0).slice();
    const moved = new ClothSimulation(spec).positionsAt(CLOTH_STEP_RATE * 2);
    const top = (spec.columns + 1) * spec.rows;
    for (let i = 0; i <= spec.columns; i++) expect(moved.slice((top + i) * 3, (top + i) * 3 + 3)).toEqual(rest.slice((top + i) * 3, (top + i) * 3 + 3));
    expect(moved[2]).toBeGreaterThan(0.05);
    expect(Array.from(moved).every(Number.isFinite)).toBe(true);
    // Nearly inextensible: the bottom edge keeps its rest width.
    const width = Math.hypot(moved[spec.columns * 3] - moved[0], moved[spec.columns * 3 + 1] - moved[1], moved[spec.columns * 3 + 2] - moved[2]);
    expect(width).toBeLessThanOrEqual(spec.width * 1.02);
  });

  it('turns the finished sheet about its upright axis without changing its motion (Turn)', () => {
    const head = clothGridAt(small(), 1.5), turned = clothGridAt(small({ turn: 90 }), 1.5);
    for (let index = 0; index < head.positions.length; index += 3) {
      // x' = x cos + z sin, z' = z cos − x sin at 90°: x' = z, z' = −x; the height stays.
      expect(turned.positions[index]).toBeCloseTo(head.positions[index + 2], 9);
      expect(turned.positions[index + 1]).toBe(head.positions[index + 1]);
      expect(turned.positions[index + 2]).toBeCloseTo(-head.positions[index], 9);
    }
    expect(isClothSpec(small({ turn: 32 }))).toBe(true);
    expect(isClothSpec(small({ turn: 400 }))).toBe(false);
    // A graph saved before Turn existed compiles to a head-on sheet.
    const saved = createDefaultWeaveGraph();
    delete saved.nodes.find(node => node.id === 'cloth')!.constants!.turn;
    expect(compileClothSpec(saved, saved.nodes.find(node => node.id === 'cloth')!, read).turn).toBe(0);
  });

  it('binds rest-sheet curves onto the simulated surface', () => {
    const still = clothGridAt(small({ winds: [], turbulence: [], preroll: 0 }), 0);
    const points = Float32Array.of(0.3, -0.2, 0.05, -1.1, 0.7, 0, 1.3, 0, -0.02);
    const bound = bindToCloth(points, still, 1);
    for (let index = 0; index < points.length; index++) expect(bound[index]).toBeCloseTo(points[index], 6);
    const grid = clothGridAt(small(), 1.5);
    const center = sampleClothGrid(grid, grid.columns / 2, grid.rows / 2).point, corner = sampleClothGrid(grid, 0, 0).point;
    const node = (i: number, j: number) => Array.from(grid.positions.slice((j * (grid.columns + 1) + i) * 3, (j * (grid.columns + 1) + i) * 3 + 3));
    center.forEach((value, axis) => expect(value).toBeCloseTo(node(grid.columns / 2, grid.rows / 2)[axis], 9));
    corner.forEach((value, axis) => expect(value).toBeCloseTo(node(0, 0)[axis], 9));
  });

  it('compiles, transports and evaluates the default waving weave', () => {
    const graph = createDefaultWeaveGraph();
    const program = compile(graph, 1.25);
    expect(program.stages.map(stage => stage.kind)).toEqual(['weave-pattern', 'set-position', 'thread-along', 'yarn-profile', 'surface-bind']);
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    const tampered = structuredClone(program) as any;
    tampered.stages[4].cloth.columns = 4096;
    expect(isGeometryProgram(tampered)).toBe(false);
    const waving = evaluateGeometryProgram(program).positions;
    expect(Math.max(...Array.from(waving.filter((_, index) => index % 3 === 2), Math.abs))).toBeGreaterThan(0.1);
    graph.groups!.find(group => group.id === 'wind-cloth')!.bypassed = true;
    expect(compile(graph, 1.25).stages.map(stage => stage.kind)).toEqual(['weave-pattern', 'set-position', 'thread-along', 'yarn-profile']);
  });

  it('runs cloth in the source time of the host clip', () => {
    const clip = { inPoint: 4, outPoint: 10, duration: 6, reversed: false, speed: 1 };
    expect(weaveSimulationTime(clip, 1.5)).toBeCloseTo(5.5, 9);
    expect(weaveSimulationTime({ ...clip, speed: 2, outPoint: 16 }, 1.5)).toBeCloseTo(7, 9);
    expect(weaveSimulationTime({}, 1.5)).toBe(1.5);
  });

  it('simulates a keyframed Wind once for the whole clip, so a keyed gust builds up instead of restarting the cloth', () => {
    const graph = createDefaultWeaveGraph(), cloth = graph.nodes.find(node => node.id === 'cloth')!;
    const key = (time: number, value: number) => ({ id: `w${time}`, clipId: 'c', time, property: 'effect.fx.wind', value, easing: 'linear' }) as Keyframe;
    const keys = [key(0.5, 0), key(1.5, 2)];
    const specAt = (time: number, clock?: SimulationClock) => compileClothSpec(graph, cloth, geometryParameterReader({ wind: 0.35 }, 'fx', keys, time, clock));
    // Every frame reads the same spec (one cached simulation); the course rides along as a track.
    expect(JSON.stringify(specAt(0.2))).toBe(JSON.stringify(specAt(2.7)));
    const wind = specAt(1).winds[0];
    expect(wind.strengthTrack).toMatchObject({ start: 0.5, rate: 30 });
    expect(sampleSimulationTrack(wind.strengthTrack!, 1)).toBeCloseTo(1, 6);
    expect(sampleSimulationTrack(wind.strengthTrack!, 0)).toBe(0);
    expect(sampleSimulationTrack(wind.strengthTrack!, 9)).toBe(2);
    expect(windVelocity(specAt(1), 0.4)).toEqual([0, 0, 0]);
    expect(isClothSpec(specAt(1))).toBe(true);
    // Before the gust the sheet hangs as without wind; after it, it has moved.
    const still = { ...specAt(0), winds: [{ ...wind, strength: 0, strengthTrack: undefined }] };
    delete still.winds[0].strengthTrack;
    const before = clothGridAt(small({ ...specAt(0) }), 0.4).positions, calm = clothGridAt(small(still), 0.4).positions;
    expect(Array.from(before).every((value, index) => Math.abs(value - calm[index]) < 1e-9)).toBe(true);
    const after = clothGridAt(small({ ...specAt(0) }), 2.5).positions, calmAfter = clothGridAt(small(still), 2.5).positions;
    expect(Array.from(after).some((value, index) => Math.abs(value - calmAfter[index]) > 1e-3)).toBe(true);
    // A trimmed clip keys in clip time; the track runs in the clip's source time.
    const trimmed = weaveSimulationClock({ inPoint: 4, outPoint: 10, duration: 6, reversed: false, speed: 1 });
    expect(specAt(1, trimmed).winds[0].strengthTrack!.start).toBeCloseTo(4.5, 6);
  });
});
