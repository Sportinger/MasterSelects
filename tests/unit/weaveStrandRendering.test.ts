import { describe, expect, it } from 'vitest';
import { createDefaultWeaveGraph, createWaveStrandsGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph, type GeometryProgram } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { cameraPositionFromView, parseStrandColor, SEGMENT_HAS_NEXT, SEGMENT_HAS_PREVIOUS, strandDepthRange, strandSceneMatrix, strandSegmentStarts, strandSubdivisions, worldMatrixScale } from '../../src/engine/native3d/passes/StrandPass';
import { collectScene3DLayers } from '../../src/engine/scene/SceneLayerCollector';
import { canRenderNativeScene } from '../../src/engine/native3d/sceneRenderer/drawPlan';
import { validateWorkerGpuFrameStackContract } from '../../src/services/render/workerGpuFrameStackContract';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';
import type { Effect } from '../../src/types/effects';
import type { Layer, LayerRenderData } from '../../src/engine/core/types';

const program = (): GeometryProgram => compileGeometryGraph(createWaveStrandsGraph(), geometryParameterReader({}));
const weave = (overrides: Partial<Effect> = {}): Effect => ({ id: 'fx-weave', name: 'Weave', type: 'weave', enabled: true, params: {}, ...overrides });

describe('Weave strand rendering', () => {
  it('validates transported geometry programs', () => {
    const valid = structuredClone(program());
    expect(isGeometryProgram(valid)).toBe(true);
    const tampered = (edit: (value: any) => void) => { const value = structuredClone(valid) as any; edit(value); return isGeometryProgram(value); };
    expect(tampered(value => { value.pointCount += 1; })).toBe(false);
    expect(tampered(value => { value.stages[1].count = 1_000_000; value.strandCount = 1_000_000; value.pointCount = 2_000_000_000; })).toBe(false);
    expect(tampered(value => { value.stages[2].offset.instructions[0].operation = 'sample-image'; })).toBe(false);
    expect(tampered(value => { value.stages[2].offset.instructions[0].inputs = [5]; })).toBe(false);
    expect(tampered(value => { value.stages.unshift(value.stages[1]); })).toBe(false);
    expect(tampered(value => { value.render.width = -1; })).toBe(false);
  });

  it('builds strand sources only for enabled, rendering Weave effects', () => {
    const clip = { id: 'clip', effects: [weave()] };
    const [built] = buildStrandsLayerSources(clip, 0, []);
    expect(built.source.strands).toMatchObject({ clipId: 'clip', effectId: 'fx-weave', program: { strandCount: 40,
      render: { profile: { plies: 3, fibers: 5 } } } });
    expect(buildStrandsLayerSources({ id: 'clip', effects: [weave({ enabled: false })] }, 0, [])).toEqual([]);
    const graph = createDefaultWeaveGraph();
    graph.nodes.find(node => node.id === 'render')!.bypassed = true;
    expect(buildStrandsLayerSources({ id: 'clip', effects: [weave({ operatorGraph: graph })] }, 0, [])).toEqual([]);
  });

  it('collects strand layers into a renderable native scene', () => {
    const [built] = buildStrandsLayerSources({ id: 'clip', effects: [weave()] }, 0, []);
    const layer: Layer = { id: 'layer_strands', name: 'Weave', sourceClipId: 'clip', visible: true, opacity: 1, blendMode: 'normal',
      source: built.source, effects: [], position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, is3D: true };
    const data: LayerRenderData = { layer, isVideo: false, externalTexture: null, textureView: null, sourceWidth: 1920, sourceHeight: 1080 };
    const scene = collectScene3DLayers([data], { width: 1920, height: 1080 });
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({ kind: 'strands', clipId: 'clip', strands: { effectId: 'fx-weave' } });
    expect(canRenderNativeScene(scene, [], [], [], [])).toBe(true);
  });

  it('admits strand layers in the Worker native scene contract', () => {
    const { stack, admission, payload } = nativeSceneFixture();
    const base = payload.layers[0];
    (payload.layers as unknown[]).push({ layerId: 'strands', clipId: base.clipId, worldMatrix: [...base.worldMatrix], opacity: 1,
      kind: 'strands', effectId: 'fx-weave', program: structuredClone(program()) });
    expect(validateWorkerGpuFrameStackContract(structuredClone(stack), admission).ok).toBe(true);
    ((payload.layers as any[]).at(-1)).program.stages[2].offset.instructions[0].operation = 'eval';
    expect(validateWorkerGpuFrameStackContract(structuredClone(stack), admission).ok).toBe(false);
  });

  it('keeps old graphs on hashed rendering and transports an explicit coverage choice', () => {
    const graph = createWaveStrandsGraph();
    expect(program().render?.antialiasing).toBeUndefined();
    graph.nodes.find(node => node.id === 'render')!.constants!.antialiasing = 'coverage4x';
    const quality = compileGeometryGraph(graph, geometryParameterReader({}));
    expect(quality.render?.antialiasing).toBe('coverage4x');
    expect(isGeometryProgram(structuredClone(quality))).toBe(true);
    expect(isGeometryProgram({ ...quality, render: { ...quality.render, antialiasing: 'unknown' } })).toBe(false);
    graph.nodes.find(node => node.id === 'render')!.constants!.antialiasing = 'analytic';
    const analytic = compileGeometryGraph(graph, geometryParameterReader({}));
    expect(analytic.render?.antialiasing).toBe('analytic');
    expect(isGeometryProgram(structuredClone(analytic))).toBe(true);
    const { stack, admission, payload } = nativeSceneFixture();
    const base = payload.layers[0];
    (payload.layers as unknown[]).push({ layerId: 'quality-strands', clipId: base.clipId,
      worldMatrix: [...base.worldMatrix], opacity: 1, kind: 'strands', effectId: 'fx-weave', program: quality });
    expect(validateWorkerGpuFrameStackContract(structuredClone(stack), admission).ok).toBe(true);
  });

  it('preserves the coverage choice through stored effect graphs and frame sampling', () => {
    const graph = createDefaultWeaveGraph();
    graph.nodes.find(node => node.id === 'render')!.constants!.antialiasing = 'coverage4x';
    const effects = [weave({ operatorGraph: JSON.parse(JSON.stringify(graph)) })];
    expect(buildStrandsLayerSources({ id: 'clip', effects }, 5, [])[0].source.strands.program.render?.antialiasing)
      .toBe('coverage4x');
  });

  it('spreads the analytic depth key over the depth range a layer can reach', () => {
    const view = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1]);
    const near = 1, far = 100;
    // WebGPU perspective: depth 0 at the near plane, 1 at the far plane.
    const projection = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0]);
    const ndc = (distance: number) => (far / (near - far) * -distance + near * far / (near - far)) / distance;
    const world = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const [low, high] = strandDepthRange(world, 1, { viewMatrix: view, projectionMatrix: projection });
    expect(low).toBeCloseTo(ndc(4), 6);
    expect(high).toBeCloseTo(ndc(6), 6);
    // Bounds reaching behind the camera start at the near plane.
    expect(strandDepthRange(world, 10, { viewMatrix: view, projectionMatrix: projection })[0]).toBe(0);
  });

  it('prepares draw data for ribbons', () => {
    const P = SEGMENT_HAS_PREVIOUS, N = SEGMENT_HAS_NEXT;
    expect(Array.from(strandSegmentStarts(Uint32Array.of(0, 4), Uint32Array.of(4, 3))))
      .toEqual([0 | N, 1 | P | N, 2 | P, 4 | N, 5 | P].map(value => value >>> 0));
    expect(parseStrandColor('#e8e2d6').map(value => Math.round(value * 255))).toEqual([232, 226, 214]);
    expect(parseStrandColor('not a color')).toEqual([1, 1, 1]);
    // Camera at (0, 0, 5) looking down -Z: view translation is (0, 0, -5).
    const view = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1);
    expect(cameraPositionFromView(view)).toEqual([-0, -0, 5]);
    expect(worldMatrixScale(Float32Array.of(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1))).toBe(2);
  });

  it('mirrors Y-up strand geometry into the Y-down scene', () => {
    const world = Float32Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]);
    // Local +Y (the top edge, against gravity) lands on scene -Y, which the scene draws upward.
    expect(Array.from(strandSceneMatrix(world))).toEqual([2, 0, 0, 0, -0, -3, -0, -0, 0, 0, 4, 0, 5, 6, 7, 1]);
    expect(worldMatrixScale(strandSceneMatrix(world))).toBeCloseTo(3, 9);
    expect(Array.from(world)).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]);
  });

  it('splits segments into spline pieces only when they span many pixels', () => {
    const world = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const camera = { projectionMatrix: Float32Array.from([1, 0, 0, 0, 0, 1.7320508, 0, 0, 0, 0, -1, -1, 0, 0, -0.01, 0]),
      viewport: { width: 1920, height: 1080 } };
    // A 0.00625-long segment of a 1.44-wide sheet seen from 3 units away spans about 2 pixels.
    expect(strandSubdivisions(0.00625, 1.44, world, [0, 0, 3], camera)).toBe(1);
    // From 1.6 units the nearest edge is close: the pieces keep curves round.
    const close = strandSubdivisions(0.00625, 1.44, world, [0, 0, 1.6], camera);
    expect(close).toBeGreaterThan(1);
    expect(strandSubdivisions(0.00625, 1.44, world, [0, 0, 1.46], camera)).toBe(8);
    expect(strandSubdivisions(0.00625, 1.44, Float32Array.from([6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 1]), [0, 0, 3], camera)).toBe(8);
  });
});
