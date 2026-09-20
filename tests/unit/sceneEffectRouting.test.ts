import { describe, expect, it } from 'vitest';
import type { LayerRenderData } from '../../src/engine/core/types';
import { collectScene3DLayers } from '../../src/engine/scene/SceneLayerCollector';
import { sceneCompositeStyle } from '../../src/engine/scene/sceneEffectRouting';
import type { Effect } from '../../src/types';

const cable: Effect = { id: 'cable', name: 'Cables', type: 'face-cables', enabled: true, params: { scene3D: true, sceneData: 'saved' } };
const brightness: Effect = { id: 'brightness', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.5 } };
function data(id: string, type: 'video' | 'light', effects: Effect[] = []): LayerRenderData {
  return { layer: { id, name: id, source: { type }, is3D: true, opacity: 1, visible: true, blendMode: 'normal',
    effects, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    isVideo: false, externalTexture: null, textureView: null, sourceWidth: 640, sourceHeight: 480 };
}
const collect = (layers: LayerRenderData[]) => collectScene3DLayers(layers, { width: 640, height: 480 });

describe('3D effect routing', () => {
  it('keeps post-render brightness with lights before or after the visual layer', () => {
    for (const layers of [[data('light', 'light'), data('face', 'video', [cable, brightness])],
      [data('face', 'video', [cable, brightness]), data('light', 'light')]]) {
      const scene = collect(layers);
      expect(sceneCompositeStyle(layers, scene, true).effects).toEqual([brightness]);
      expect(scene.find(layer => layer.kind === 'face-cables')?.layerSpaceEffects).toEqual([]);
    }
  });
  it('applies effects before cable geometry to its source texture exactly once', () => {
    const layers = [data('light', 'light'), data('face', 'video', [brightness, cable])];
    const scene = collect(layers);
    expect(scene.find(layer => layer.kind === 'face-cables')?.layerSpaceEffects).toEqual([brightness]);
    expect(sceneCompositeStyle(layers, scene, true).effects).toEqual([]);
    expect(sceneCompositeStyle(layers, scene, false).effects).toEqual([brightness]);
  });
  it('never leaks one object’s post effects onto unrelated 3D objects', () => {
    const layers = [data('face', 'video', [cable, brightness]), data('other', 'video')];
    expect(sceneCompositeStyle(layers, collect(layers), true).effects).toEqual([]);
  });
});
