import { describe, expect, it } from 'vitest';
import { cableSceneLayout, encodeCableScene, decodeCableScene, type CableSceneBake } from '../../src/services/faceCables/cableSceneData';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { buildCableSceneGeometry } from '../../src/engine/native3d/passes/faceCablePass/geometry';
import { cableSceneLights } from '../../src/engine/native3d/passes/faceCablePass/lighting';
import { buildSceneWorldMatrix } from '../../src/engine/scene/SceneTransformUtils';
import { DEFAULT_LIGHT_CLIP_SETTINGS } from '../../src/types/light';
import type { SceneLightLayer } from '../../src/engine/scene/types';
import { collectScene3DLayers } from '../../src/engine/scene/SceneLayerCollector';
import type { LayerRenderData } from '../../src/engine/core/types';

function fixture(): CableSceneBake {
  const cables = [{ ...defaultFaceCable(), segments: 4 }], layout = cableSceneLayout(cables);
  const data = new Float32Array(layout.stride * 2);
  for (let f = 0; f < 2; f++) {
    const offset = f * layout.stride + layout.offsets[0];
    data.set([1, 0.01, 1, 0.5, 0.2, 0], offset);
    for (let i = 0; i < 5; i++) data.set([i * 0.1, f * 0.2, 0.2], offset + 6 + i * 3);
  }
  return { version: 1, cables, fps: 30, frames: 2, duration: 2 / 30, data, triangles: [0, 1, 2], outline: [0, 1, 2] };
}
describe('native cable scene geometry', () => {
  it.each([90, 180, 270] as const)('preserves %s-degree raw decoder orientation without rotating HTML video twice', rotation => {
    const data = { layer: { id: 'cables', opacity: 1, is3D: true,
      position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 },
      source: { type: 'video', videoFrame: {} as VideoFrame, videoRotation: rotation },
      effects: [{ id: 'fx', type: 'face-cables', enabled: true, params: { scene3D: true, sceneData: 'artifact' } }] },
      sourceWidth: 2160, sourceHeight: 3840 } as LayerRenderData;
    const collect = () => collectScene3DLayers([data], { width: 2160, height: 3840 })[0];
    expect(collect()).toMatchObject({ kind: 'face-cables', videoRotation: rotation });
    data.layer.source!.videoFrame = undefined;
    expect(collect()).toMatchObject({ kind: 'face-cables', videoRotation: 0 });
  });
  it('persists raw XYZ and generates indexed tube surfaces independent of camera and light', () => {
    const b = fixture(), decoded = decodeCableScene(encodeCableScene(b))!;
    expect(decoded.data).toEqual(b.data);
    const first = buildCableSceneGeometry(decoded, 0)!, second = buildCableSceneGeometry(decoded, 1 / 30)!;
    expect(first.vertices.length / 12).toBe(4 + 13 * 8);
    expect(first.indices.length).toBe(6 + 12 * 8 * 6);
    expect(first.vertices.every(Number.isFinite)).toBe(true);
    expect(second.vertices[4 * 12 + 1] - first.vertices[4 * 12 + 1]).toBeCloseTo(0.2);
    expect(buildCableSceneGeometry(decoded, 0)?.vertices).toEqual(first.vertices);
    expect(buildCableSceneGeometry(decoded, decoded.duration)).toBeNull();
  });
  it('rejects malformed geometry and impossible topology before allocation', () => {
    const encoded = JSON.parse(encodeCableScene(fixture()));
    expect(decodeCableScene(JSON.stringify({ ...encoded, frames: 10000000 }))).toBeNull();
    expect(decodeCableScene(JSON.stringify({ ...encoded, triangles: [0, 1, 468] }))).toBeNull();
    expect(decodeCableScene('{bad')).toBeNull();
  });
  it('uses scene-light world transforms and shadow controls without changing the bake', () => {
    const matrix = (x: number) => buildSceneWorldMatrix({ position: { x, y: 2, z: 3 }, scale: { x: 1, y: 1, z: 1 }, rotationRadians: { x: 0, y: 0, z: 0 }, rotationDegrees: { x: 0, y: 0, z: 0 } });
    const light = { kind: 'light', worldMatrix: matrix(-2), opacity: 1, lightSettings: { ...DEFAULT_LIGHT_CLIP_SETTINGS, castsShadows: true } } as SceneLightLayer;
    const left = cableSceneLights([light], [0, 0, 0])[0];
    const right = cableSceneLights([{ ...light, worldMatrix: matrix(2) }], [0, 0, 0])[0];
    expect(left.shadows).toBe(true); expect(left.projection).not.toEqual(right.projection);
    expect(right.data[16]).toBe(2);
    expect(cableSceneLights([{ ...light, lightSettings: { ...light.lightSettings, castsShadows: false } }], [0, 0, 0])[0].data[24]).toBe(0);
  });
});
