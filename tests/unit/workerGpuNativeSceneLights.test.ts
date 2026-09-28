import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT_CLIP_SETTINGS, type LightClipSettings } from '../../src/types/light';
import type { Layer } from '../../src/types/layers';
import { validateWorkerGpuFrameStackContract } from '../../src/services/render/workerGpuFrameStackContract';
import { projectNativeSceneLayers } from '../../src/services/render/workerGpuNativeSceneProjection';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';

describe('Worker native scene lights', () => {
  it.each(['point', 'panel', 'environment'] as const)('snapshots and admits evaluated %s lighting', kind => {
    const { stack, admission, payload } = nativeSceneFixture();
    const settings: LightClipSettings = { ...DEFAULT_LIGHT_CLIP_SETTINGS, kind, intensity: 2.5, color: '#aabbcc' };
    const layer: Layer = { id: 'light', sourceClipId: 'light', name: 'light', visible: true, is3D: true,
      opacity: 1, blendMode: 'normal', rotation: 0, position: { x: 1, y: 2, z: 3 }, scale: { x: 1, y: 1 },
      effects: [], source: { type: 'light', lightSettings: settings } };
    const camera = { ...payload.camera, viewMatrix: new Float32Array(payload.camera.viewMatrix),
      projectionMatrix: new Float32Array(payload.camera.projectionMatrix) };
    const projected = projectNativeSceneLayers({ layers: [layer], width: 256, height: 256, frame: stack.frame }, camera)!;
    const light = projected.source.payload.layers[0];
    if (light.kind !== 'light') throw new Error('Missing light');
    expect(light.lightSettings).toEqual(settings);
    expect(light.worldMatrix).toHaveLength(16);
    settings.intensity = 99;
    expect(light.lightSettings.intensity).toBe(2.5);
    Object.assign(payload, { layers: [light] });
    expect(validateWorkerGpuFrameStackContract(structuredClone(stack), admission).ok).toBe(true);
    settings.environmentMapMediaFileId = 'environment';
    expect(() => projectNativeSceneLayers({ layers: [layer], width: 256, height: 256, frame: stack.frame }, camera))
      .toThrow('environment-map resources');
  });
  it.each([
    { intensity: -1 }, { intensity: Infinity }, { intensity: 1e100 }, { diameter: 0 },
    { shadowStrength: 2 }, { castsShadows: 1 }, { color: 'red' }, { kind: 'spot' },
    { environmentMapUrl: 'blob:https://localhost/env' }, { environmentMapMediaFileId: 'env' },
  ])('rejects invalid or unsupported light settings %j', override => {
    const { stack, admission, payload } = nativeSceneFixture();
    (payload.layers as unknown[]).push({ kind: 'light', layerId: 'light', clipId: 'light', opacity: 1,
      worldMatrix: [...payload.layers[0].worldMatrix], lightSettings: { ...DEFAULT_LIGHT_CLIP_SETTINGS, ...override } });
    expect(validateWorkerGpuFrameStackContract(stack, admission).ok).toBe(false);
  });
});
