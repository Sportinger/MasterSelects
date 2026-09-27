import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectMainNativeScene } from '../../src/services/render/workerGpuNativeSceneMainProjection';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import type { Layer } from '../../src/types/layers';

const host = vi.hoisted(() => ({ state: { activeCompositionId: 'native-comp', files: [] as { id: string; type: string; url: string; name: string }[] },
  camera: vi.fn(), effectors: vi.fn(() => []) }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => host.state } }));
vi.mock('../../src/engine/scene/SceneCameraUtils', () => ({ resolveRenderableSharedSceneCamera: host.camera }));
vi.mock('../../src/engine/scene/SceneEffectorUtils', () => ({ collectActiveSceneSplatEffectors: host.effectors }));

function input() {
  const fixture = nativeSceneFixture(0.2, 1000, 'main-project', 'image');
  const native = fixture.payload.layers[0];
  if (native.kind !== 'flock') throw new Error('Invalid fixture');
  const compiled = compileFlockDefinition(native.definition);
  if (!compiled.ok) throw new Error('Invalid graph');
  host.camera.mockReturnValue({ ...fixture.payload.camera, viewMatrix: new Float32Array(fixture.payload.camera.viewMatrix), projectionMatrix: new Float32Array(fixture.payload.camera.projectionMatrix) });
  const layer: Layer = { id: 'flock', sourceClipId: 'particles', name: 'flock', visible: true, opacity: 1, blendMode: 'normal',
    is3D: true, effects: [], rotation: 0, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 },
    source: { type: 'flock', flock: { clipId: 'particles', definition: native.definition, program: compiled.program,
      diagnostics: [], keyframes: [], sourceTime: 0.2, consumer: 'preview' } } };
  return { layers: [layer], width: 256, height: 256, frame: fixture.stack.frame };
}

describe('main timeline to Worker scene adapter', () => {
  beforeEach(() => { host.state.activeCompositionId = 'native-comp'; host.state.files = []; vi.clearAllMocks(); });
  it('resolves referenced image metadata without copying runtime handles', () => {
    host.state.files = [{ id: 'stack-image', type: 'image', url: 'blob:https://localhost/image', name: 'image.png' }];
    const request = input();
    const result = projectMainNativeScene(request)!;
    expect(result.source.payload.assets).toEqual([{ id: 'stack-image', kind: 'image', url: 'blob:https://localhost/image', fileName: 'image.png' }]);
    expect(host.camera).toHaveBeenCalledWith({ width: 256, height: 256 }, 0.2, undefined);
    expect(result.source.payload.layers[0].worldMatrix).toHaveLength(16);
  });
  it('rejects missing referenced media before dispatch', () => {
    expect(() => projectMainNativeScene(input())).toThrow("image asset 'stack-image' is unavailable");
  });
  it('requires an authoritative camera context for another composition', () => {
    host.state.activeCompositionId = 'other';
    expect(() => projectMainNativeScene(input())).toThrow('composition camera context');
    expect(host.camera).not.toHaveBeenCalled();
  });
  it('never falls back to the root timeline for missing nested clips', () => {
    expect(() => projectMainNativeScene({ ...input(), sceneContext: { compositionId: 'nested' } })).toThrow('nested composition timeline context');
    expect(host.camera).not.toHaveBeenCalled();
  });
});
