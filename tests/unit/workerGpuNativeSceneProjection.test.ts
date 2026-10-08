import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types/layers';
import type { SceneCamera } from '../../src/engine/scene/types';
import { projectNativeSceneLayers } from '../../src/services/render/workerGpuNativeSceneProjection';
import { buildWorkerGpuFrameStackProjectionRequest } from '../../src/services/render/workerGpuFrameStackHostProjection';
import { projectWorkerGpuFrameStack } from '../../src/services/render/workerGpuFrameStackProjector';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { createWaveStrandsGraph } from '../../src/services/operators/geometry/weaveGraph';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';

const fixture = nativeSceneFixture();
const camera: SceneCamera = { ...fixture.payload.camera,
  viewMatrix: new Float32Array(fixture.payload.camera.viewMatrix), projectionMatrix: new Float32Array(fixture.payload.camera.projectionMatrix) };
const layer = (id: string, is3D = false): Layer => ({ id, sourceClipId: id, name: id, visible: true,
  opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
  is3D, source: is3D ? { type: 'model', meshType: 'cube' } : { type: 'solid', color: '#123456' }, effects: [] });
const input = (layers: Layer[]) => ({ layers, width: 256, height: 256, frame: fixture.stack.frame,
  occurrenceNamespace: 'root', intent: 'preview' as const, surface: 'preview' as const, nowMs: 1000,
  resolveVideoSource: () => null,
  projectNativeScene: (request: Parameters<typeof projectNativeSceneLayers>[0]) => projectNativeSceneLayers(request, camera) });

describe('host shared native scene projection', () => {
  it('preserves shared scene bottom-to-top order and its position among 2D layers', async () => {
    const layers = [layer('top'), layer('mesh-top', true), layer('middle'), layer('mesh-bottom', true), layer('bottom')];
    const original = structuredClone(layers);
    const request = buildWorkerGpuFrameStackProjectionRequest(input(layers));
    expect(request.layers.map(l => l.id)).toEqual(['top', 'middle', '__worker_scene_3d__', 'bottom']);
    const source = request.sources.find(s => s.kind === 'native-scene');
    expect(source?.payload.layers.map(l => l.layerId)).toEqual(['mesh-bottom', 'mesh-top']);
    const stack = await projectWorkerGpuFrameStack({ ...request, clock: () => 1000 });
    expect(stack.bindings.some(b => b.runtimeSourceKind === 'nativeScene')).toBe(true);
    expect(layers).toEqual(original);
  });

  it('projects nested 3D without mutating the source or weakening occurrence identity', async () => {
    const nested = [layer('nested-mesh', true)];
    const parent = layer('nested');
    parent.source = { type: 'video', nestedComposition: { compositionId: 'child', currentTime: 0.05,
      width: 256, height: 256, layers: nested, sceneClips: [], sceneTracks: [] } };
    const request = buildWorkerGpuFrameStackProjectionRequest(input([parent]));
    expect(parent.source.nestedComposition!.layers).toBe(nested);
    const stack = await projectWorkerGpuFrameStack({ ...request, clock: () => 1000 });
    const payload = stack.bindings[0].payload;
    expect(payload.kind).toBe('nested-stack');
    if (payload.kind !== 'nested-stack') throw new Error('Missing nested scene');
    expect(payload.stack.frame.timelineTime).toBe(0.05);
    expect(payload.stack.bindings[0].payload.kind).toBe('native-scene');
  });

  it('keeps the original layer array for a 2D-only stack', () => {
    const layers = [layer('flat')];
    expect(buildWorkerGpuFrameStackProjectionRequest(input(layers)).layers).toBe(layers);
  });

  it('declines downstream strand effects instead of silently losing them during transport', () => {
    const yarn = layer('yarn', true);
    yarn.source = buildStrandsLayerSources({ id:'yarn', effects:[{ id:'weave',name:'Weave',type:'weave',enabled:true,params:{},operatorGraph:createWaveStrandsGraph() }] }, 0, [])[0].source;
    yarn.effects = [{ id:'glow',name:'Glow',type:'glow',enabled:true,params:{amount:3} }];
    expect(() => buildWorkerGpuFrameStackProjectionRequest(input([yarn]))).toThrow('post-projection effects');
  });

  it('rejects an unsupported 3D source rather than dropping it', () => {
    const unsupported = layer('text', true);
    unsupported.source = { type: 'model', meshType: 'text3d' };
    expect(() => buildWorkerGpuFrameStackProjectionRequest(input([unsupported]))).toThrow("'text3d'");
  });
});
