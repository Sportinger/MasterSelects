import { describe, expect, it } from 'vitest';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { createDefaultWeaveGraph, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { applyFiberMaterialEdit, strandRenderHasFiberMaterial } from '../../src/services/operators/geometry/fiberMaterialOperators';
import { evaluateFiberAttributes } from '../../src/services/operators/geometry/fiberMaterialAttributes';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { packStrandLook, STRAND_LOOK_FLOATS } from '../../src/engine/native3d/passes/strandLook';
import { compileSceneGraph, defaultSceneGraph } from '../../src/services/operators/sceneGraph';
import { mergeModelMaterialSettings } from '../../src/types/modelMaterial';
import { normalizeCompositionRenderSettings, normalizeExportRenderQuality, normalizeCameraLens } from '../../src/engine/native3d/pathtrace/contracts/ptTypes';
import { FIBER_MATERIAL_PRESET_VALUES } from '../../src/engine/native3d/pathtrace/materials/ptMaterials';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';

const read = geometryParameterReader({});

/** The default Weave graph as projects saved it before Fiber Material existed. */
function legacyWeaveGraph(): EffectOperatorGraph {
  const graph = structuredClone(createDefaultWeaveGraph());
  graph.nodes = graph.nodes.filter(node => node.operator !== 'material.fiber');
  graph.edges = graph.edges.filter(edge => edge.from !== 'fiber' && edge.to !== 'fiber');
  graph.edges.push({ id: 'flyaways-curves-bind-curves', from: 'flyaways', output: 'curves', to: 'bind', input: 'curves' });
  graph.groups = graph.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => id !== 'fiber') }));
  for (const node of graph.nodes) if (node.operator === 'render.strands') delete node.constants?.subdivision;
  return graph;
}

function curveGraph(materials: Array<{ id: string; constants?: BoundOperatorNode['constants'] }>, withSelection = false): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    { id: 'line', operator: 'geometry.curve-line', operatorVersion: 1, bindings: {}, constants: { points: 8, length: 1, axis: 'x' } },
    { id: 'array', operator: 'geometry.strand-array', operatorVersion: 1, bindings: {}, constants: { count: 4, spacing: 0.1, axis: 'y' } },
    ...materials.map(({ id, constants }) => ({ id, operator: 'material.fiber', operatorVersion: 1 as const, bindings: {}, constants })),
    { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {}, constants: { width: 0.01, color: '#336699' } },
    { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
  ];
  const chain = ['line', 'array', ...materials.map(material => material.id), 'render'];
  const edges = chain.slice(1).map((to, index) => ({ id: `e${index}`, from: chain[index], output: 'curves', to, input: 'curves' }));
  edges.push({ id: 'out', from: 'render', output: 'scene', to: 'output', input: 'scene' });
  if (withSelection) {
    nodes.push({ id: 'info', operator: 'geometry.curve-info', operatorVersion: 1, bindings: {} });
    nodes.push({ id: 'half', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1.5 } });
    nodes.push({ id: 'pick', operator: 'compare.greater.scalar', operatorVersion: 1, bindings: {} });
    edges.push({ id: 's1', from: 'info', output: 'strand', to: 'pick', input: 'a' }, { id: 's2', from: 'half', output: 'value', to: 'pick', input: 'b' },
      { id: 's3', from: 'pick', output: 'value', to: materials.at(-1)!.id, input: 'selection' });
  }
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes, edges, layout: {} };
}

describe('Fiber Material node', () => {
  it('is part of new default Weave graphs as wool between Flyaways and Surface Bind', () => {
    const graph = createDefaultWeaveGraph();
    expect(validateWeaveGraph(graph)).toEqual([]);
    expect(graph.edges.some(edge => edge.from === 'flyaways' && edge.to === 'fiber')).toBe(true);
    expect(graph.edges.some(edge => edge.from === 'fiber' && edge.to === 'bind')).toBe(true);
    const program = compileGeometryGraph(graph, read, undefined, { time: 6, simulationTime: 6 });
    expect(program.render?.materials).toHaveLength(1);
    expect(program.render?.materials?.[0].roughnessLongitudinal).toBe(FIBER_MATERIAL_PRESET_VALUES.wool.roughnessLongitudinal);
    expect(isGeometryProgram(program)).toBe(true);
    expect(strandRenderHasFiberMaterial(graph, 'render')).toBe(true);
  });

  it('leaves saved graphs without it unchanged: no materials, no subdivision, the Strand Render color and the legacy raster look', () => {
    const graph = legacyWeaveGraph();
    expect(validateWeaveGraph(graph)).toEqual([]);
    const program = compileGeometryGraph(graph, read, undefined, { time: 6, simulationTime: 6 });
    expect(program.render?.materials).toBeUndefined();
    expect(program.render?.subdivision).toBeUndefined();
    expect(program.render?.color).toBe('#e8e2d6');
    expect(strandRenderHasFiberMaterial(graph, 'render')).toBe(false);
    const look = new Float32Array(STRAND_LOOK_FLOATS);
    packStrandLook(program.render!, false, look, 0);
    expect(Array.from(look.slice(0, 11))).toEqual([90, 24, 0.22, 0.3, Math.fround(0.35), Math.fround(-0.08), Math.fround(0.12), 0, 1, 1, 1].map(Math.fround));
  });

  it('applies presets and turns into Custom when a value is edited', () => {
    const node: BoundOperatorNode = { id: 'fiber', operator: 'material.fiber', operatorVersion: 1, bindings: {}, constants: { preset: 'wool' } };
    expect(applyFiberMaterialEdit(node, 'preset', 'silk')).toBe(true);
    expect(node.constants?.roughnessLongitudinal).toBe(FIBER_MATERIAL_PRESET_VALUES.silk.roughnessLongitudinal);
    expect(node.constants?.color).toMatch(/^#[0-9a-f]{6}$/);
    applyFiberMaterialEdit(node, 'matte', 0.4);
    expect(node.constants?.preset).toBe('custom');
    expect(node.constants?.matte).toBe(0.4);
    expect(applyFiberMaterialEdit({ id: 'x', operator: 'geometry.flyaways', operatorVersion: 1, bindings: {} }, 'density', 2)).toBe(false);
  });

  it('assigns the last selected material per point and validates transported programs', () => {
    const program = compileGeometryGraph(curveGraph([{ id: 'wool', constants: { preset: 'wool' } }, { id: 'silk', constants: { preset: 'silk', color: '#ff0000' } }], true), read);
    expect(program.render?.materials?.map(material => material.nodeId)).toEqual(['wool', 'silk']);
    expect(isGeometryProgram(program)).toBe(true);
    const curves = evaluateGeometryProgram(program);
    const attributes = evaluateFiberAttributes(curves, program.render!.materials!);
    const materialOfStrand = (strand: number) => attributes[curves.starts[strand] * 2 + 1] & 0xffff;
    expect([0, 1, 2, 3].map(materialOfStrand)).toEqual([0, 0, 1, 1]);
    const broken = structuredClone(program);
    broken.render!.materials![0].color = 'red';
    expect(isGeometryProgram(broken)).toBe(false);
  });

  it('compiles the Subdivision of Strand Render and rejects values outside 1 to 16', () => {
    const graph = curveGraph([]);
    graph.nodes.find(node => node.id === 'render')!.constants!.subdivision = 4;
    expect(compileGeometryGraph(graph, read).render?.subdivision).toBe(4);
    graph.nodes.find(node => node.id === 'render')!.constants!.subdivision = 40;
    expect(() => compileGeometryGraph(graph, read)).toThrow(/subdivision/i);
  });
});

describe('surface materials and render settings', () => {
  it('keeps the plain look for material.surface defaults and adds roughness, metallic and emission when set', () => {
    const definition = defaultSceneGraph();
    expect(compileSceneGraph(definition)).not.toHaveProperty('roughness');
    definition.params.material_roughness = 0.3;
    definition.params.material_metallic = 1;
    definition.params.material_emissionStrength = 2;
    definition.params.material_emissionGreen = 0.5;
    const plan = compileSceneGraph(definition);
    expect(plan.roughness).toBe(0.3);
    expect(plan.metallic).toBe(1);
    expect(plan.emission).toEqual([2, 1, 2]);
  });

  it('keeps model materials without the new fields unchanged', () => {
    const merged = mergeModelMaterialSettings({ baseColor: '#112233' });
    expect(merged).not.toHaveProperty('roughness');
    expect(mergeModelMaterialSettings({ roughness: 2, emissionStrength: -1 })).toMatchObject({ roughness: 1, emissionStrength: 0 });
  });

  it('normalizes stored render settings, lens and export quality', () => {
    expect(normalizeCompositionRenderSettings(undefined).engine).toBe('raster');
    expect(normalizeCompositionRenderSettings({ engine: 'path-traced', renderScale: 0.3, extra: 1 })).toEqual({
      engine: 'path-traced', renderScale: 0.5, stillSamples: 256, maxBounces: 8, clampIndirect: 10 });
    expect(normalizeCameraLens({ exposure: 40, toneMapping: 'agx', fStop: -1 })).toMatchObject({ exposure: 16, toneMapping: 'agx', fStop: 0 });
    expect(normalizeExportRenderQuality(undefined).engine).toBe('raster');
    expect(normalizeExportRenderQuality({ engine: 'path-traced' }).engine).toBe('path-traced');
    expect(normalizeExportRenderQuality({ engine: undefined }).engine).toBeUndefined();
    expect(normalizeExportRenderQuality({ samplesPerPixel: 0, denoise: false })).toMatchObject({ samplesPerPixel: 1, denoise: false });
  });
});

describe('project repository classification of the new fields', () => {
  it('splits compositions, camera lenses, model materials and export settings without unclassified fields', async () => {
    const { splitNestedDomain } = await import('../../src/services/project/repository/domains/nestedOwnership');
    expect(() => splitNestedDomain({ id: 'c', name: 'C', width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000000',
      folderId: null, tracks: [], clips: [], renderSettings: { engine: 'path-traced', renderScale: 0.5, stillSamples: 256, maxBounces: 8,
        clampIndirect: 10, region: { x: 0, y: 0, width: 0.5, height: 0.5 } } }, 'ProjectComposition')).not.toThrow();
    expect(() => splitNestedDomain({ fov: 50, near: 0.1, far: 100, exposure: 1, toneMapping: 'agx', fStop: 2.8, focusDistance: 2,
      shutterAngle: 180 }, 'ProjectSceneCameraSettings')).not.toThrow();
    expect(() => splitNestedDomain({ ...mergeModelMaterialSettings({}), roughness: 0.4, metallic: 1, emissionColor: '#ffffff',
      emissionStrength: 3 }, 'ProjectModelMaterialSettings')).not.toThrow();
    expect(() => splitNestedDomain({ renderQuality: { engine: 'path-traced', rasterSubSamples: 1, samplesPerPixel: 64, adaptiveThreshold: 0,
      timeLimitSeconds: 0, denoise: true } }, 'ProjectExportSettings')).not.toThrow();
  });
});
